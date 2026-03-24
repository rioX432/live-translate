import { app, screen, ipcMain } from 'electron'
import { join } from 'path'
import { GoogleTranslator } from '../engines/translator/GoogleTranslator'
import { DeepLTranslator } from '../engines/translator/DeepLTranslator'
import { GeminiTranslator } from '../engines/translator/GeminiTranslator'
import { MicrosoftTranslator } from '../engines/translator/MicrosoftTranslator'
import { ApiRotationController } from '../engines/translator/ApiRotationController'
import type { ProviderConfig, QuotaStore } from '../engines/translator/ApiRotationController'
import { SLMTranslator } from '../engines/translator/SLMTranslator'
import { detectGpu } from '../engines/gpu-detector'
import { isGGUFDownloaded, getGGUFVariants, getHunyuanMTVariants, getHunyuanMT15Variants, getWhisperVariants, isModelDownloaded as isWhisperModelDownloaded } from '../engines/model-downloader'
import type { SLMModelSize, WhisperVariant } from '../engines/model-downloader'
import { listPlugins } from '../engines/plugin-loader'
import { TranscriptLogger } from '../logger/TranscriptLogger'
import * as SessionManager from '../logger/SessionManager'
import { store } from './store'
import type { AppSettings, SubtitleSettings } from './store'
import { sanitizeErrorMessage } from './error-utils'
import { createLogger } from './logger'
import { getSubtitleHeight } from './window-manager'
import { WsAudioServer } from './ws-audio-server'
import type { AppContext } from './app-context'
import type { EngineConfig } from '../engines/types'

const log = createLogger('ipc')

/** Monthly character limits for API rotation providers */
const QUOTA_LIMITS = {
  microsoft: 2_000_000,
  google: 480_000,
  deepl: 500_000,
  gemini: 1_000_000
} as const

/** Pipeline start config with API keys */
interface PipelineStartConfig extends EngineConfig {
  apiKey?: string
  deeplApiKey?: string
  geminiApiKey?: string
  microsoftApiKey?: string
  microsoftRegion?: string
}

const DEFAULT_WS_PORT = 9876

/** Register all IPC handlers (pipeline, settings, session, display, ws-audio) */
export function registerIpcHandlers(ctx: AppContext): void {
  // --- Pipeline control ---

  ipcMain.handle('pipeline-start', async (_event, config: PipelineStartConfig) => {
    if (!ctx.pipeline) return { error: 'Pipeline not initialized' }
    if (ctx.pipeline.active) return { error: 'Pipeline already running' } // #30

    try {
      // Register online translators with provided API keys
      if (config.apiKey) {
        ctx.pipeline.registerTranslator('google-translate', () => new GoogleTranslator(config.apiKey!))
      }
      if (config.deeplApiKey) {
        ctx.pipeline.registerTranslator('deepl-translate', () => new DeepLTranslator(config.deeplApiKey!))
      }
      if (config.geminiApiKey) {
        ctx.pipeline.registerTranslator('gemini-translate', () => new GeminiTranslator(config.geminiApiKey!))
      }
      if (config.microsoftApiKey && config.microsoftRegion) {
        ctx.pipeline.registerTranslator('microsoft-translate', () =>
          new MicrosoftTranslator(config.microsoftApiKey!, config.microsoftRegion!)
        )
      }

      // Build rotation controller when rotation mode is selected
      let rotationProviders: ProviderConfig[] | null = null
      if (config.translatorEngineId === 'rotation-controller') {
        rotationProviders = []
        const statusFn = (msg: string): void => {
          ctx.mainWindow?.webContents.send('status-update', msg)
        }

        // Order: Azure (2M) → Google (480K safe cap) → DeepL (500K)
        if (config.microsoftApiKey && config.microsoftRegion) {
          rotationProviders.push({
            engine: new MicrosoftTranslator(config.microsoftApiKey, config.microsoftRegion),
            monthlyCharLimit: QUOTA_LIMITS.microsoft
          })
        }
        if (config.apiKey) {
          rotationProviders.push({
            engine: new GoogleTranslator(config.apiKey),
            monthlyCharLimit: QUOTA_LIMITS.google
          })
        }
        if (config.deeplApiKey) {
          rotationProviders.push({
            engine: new DeepLTranslator(config.deeplApiKey),
            monthlyCharLimit: QUOTA_LIMITS.deepl
          })
        }
        if (config.geminiApiKey) {
          rotationProviders.push({
            engine: new GeminiTranslator(config.geminiApiKey),
            monthlyCharLimit: QUOTA_LIMITS.gemini
          })
        }

        if (rotationProviders.length === 0) {
          return { error: 'Rotation mode requires at least one API key' }
        }

        const persistence = {
          load: (): QuotaStore => store.get('quotaTracking') as QuotaStore,
          save: (quota: QuotaStore): void => { store.set('quotaTracking', quota) }
        }

        ctx.pipeline.registerTranslator('rotation-controller', () =>
          new ApiRotationController(rotationProviders!, persistence, statusFn)
        )
      }

      try {
        await ctx.pipeline.switchEngine(config)
      } catch (err) {
        // Dispose leaked rotation provider instances on switchEngine failure
        if (rotationProviders) {
          for (const p of rotationProviders) {
            p.engine.dispose().catch((e) => log.warn('Failed to dispose rotation provider:', e))
          }
        }
        throw err
      }

      // Load glossary terms from store
      const glossaryTerms = store.get('glossaryTerms') || []
      ctx.pipeline!.setGlossary(glossaryTerms)

      // Configure language settings (#263)
      ctx.pipeline!.setLanguageConfig(store.get('sourceLanguage'), store.get('targetLanguage'))

      // Configure SimulMT (#239)
      ctx.pipeline!.setSimulMt(store.get('simulMtEnabled'), store.get('simulMtWaitK'))

      // Start logger
      ctx.logger = new TranscriptLogger((msg) => ctx.mainWindow?.webContents.send('status-update', msg))
      const sessionLabel = config.mode === 'e2e'
        ? 'Offline (Whisper Translate)'
        : `Cascade (Whisper + ${config.translatorEngineId})`
      ctx.logger.startSession(sessionLabel)

      // #62: persist session BEFORE start to avoid crash window
      store.set('activeSession', { config, startedAt: Date.now() })

      ctx.pipeline.start()

      return { success: true }
    } catch (err) {
      return { error: sanitizeErrorMessage(String(err)) }
    }
  })

  ipcMain.handle('pipeline-stop', async () => {
    // #116: log session usage
    const activeSession = store.get('activeSession')
    if (activeSession) {
      const now = Date.now()
      const logs = store.get('sessionLogs') || []
      logs.push({
        startedAt: activeSession.startedAt,
        endedAt: now,
        engineMode: String(activeSession.config?.translatorEngineId || activeSession.config?.e2eEngineId || 'unknown'),
        durationMs: now - activeSession.startedAt,
        errorCount: 0
      })
      // Keep last 100 session logs
      store.set('sessionLogs', logs.slice(-100))
    }

    await ctx.pipeline?.stop()
    ctx.logger?.endSession()
    const logPath = ctx.logger?.getLogPath()
    ctx.logger = null
    // #54: clear session on clean stop
    store.set('activeSession', null)
    return { logPath }
  })

  ipcMain.handle('get-session-start-time', () => {
    return ctx.pipeline?.sessionStartTime ?? null
  })

  // --- Display management ---

  ipcMain.handle('get-displays', () => {
    const primary = screen.getPrimaryDisplay()
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: d.id === primary.id ? `Display ${i + 1} (Main)` : `Display ${i + 1} (External)`,
      bounds: d.bounds
    }))
  })

  ipcMain.on('move-subtitle-to-display', (_event, displayId: number) => {
    const display = screen.getAllDisplays().find((d) => d.id === displayId)
    if (!display) {
      log.warn(`Display ${displayId} not found, ignoring move request`)
      return
    }
    if (ctx.subtitleWindow) {
      const h = getSubtitleHeight(display)
      ctx.subtitleWindow.setBounds({
        x: display.bounds.x,
        y: display.bounds.y + display.bounds.height - h,
        width: display.bounds.width,
        height: h
      })
    }
  })

  // Forward translation result to subtitle window (from renderer)
  ipcMain.on('translation-result', (_event, data) => {
    ctx.subtitleWindow?.webContents.send('translation-result', data)
  })

  // --- Settings persistence via electron-store (#49) ---

  ipcMain.handle('get-settings', () => {
    return {
      translationEngine: store.get('translationEngine'),
      googleApiKey: store.get('googleApiKey'),
      deeplApiKey: store.get('deeplApiKey'),
      geminiApiKey: store.get('geminiApiKey'),
      microsoftApiKey: store.get('microsoftApiKey'),
      microsoftRegion: store.get('microsoftRegion'),
      sttEngine: store.get('sttEngine'),
      selectedMicrophone: store.get('selectedMicrophone'),
      selectedDisplay: store.get('selectedDisplay'),
      subtitleSettings: store.get('subtitleSettings'),
      slmKvCacheQuant: store.get('slmKvCacheQuant'),
      slmModelSize: store.get('slmModelSize'),
      slmSpeculativeDecoding: store.get('slmSpeculativeDecoding'),
      glossaryTerms: store.get('glossaryTerms') || [],
      simulMtEnabled: store.get('simulMtEnabled'),
      simulMtWaitK: store.get('simulMtWaitK'),
      whisperVariant: store.get('whisperVariant'),
      moonshineVariant: store.get('moonshineVariant'),
      sherpaOnnxModel: store.get('sherpaOnnxModel'),
      sourceLanguage: store.get('sourceLanguage'),
      targetLanguage: store.get('targetLanguage'),
      wsAudioPort: store.get('wsAudioPort')
    }
  })

  ipcMain.handle('save-subtitle-settings', (_event, settings: Record<string, unknown>) => {
    store.set('subtitleSettings', settings as unknown as SubtitleSettings)
    ctx.subtitleWindow?.webContents.send('subtitle-settings-changed', settings)
  })

  ipcMain.handle('save-settings', (_event, settings: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(settings)) {
      store.set(key as keyof AppSettings, value as never)
    }
  })

  // Glossary terms persistence (#240)
  ipcMain.handle('save-glossary', (_event, terms: Array<{ source: string; target: string }>) => {
    store.set('glossaryTerms', terms)
    // Update running pipeline glossary in real-time
    if (ctx.pipeline) {
      ctx.pipeline.setGlossary(terms)
    }
  })

  // #54: crash recovery — check if previous session ended uncleanly
  ipcMain.handle('get-crashed-session', () => {
    const session = store.get('activeSession')
    if (session) {
      // Clear it so we don't keep detecting the same crash
      store.set('activeSession', null)
      // Validate config has required fields
      const config = session.config
      if (config && typeof config === 'object' && config.mode) {
        return session
      }
      log.warn('Invalid session config, discarding:', config)
    }
    return null
  })

  // #124: Generate meeting summary from transcript
  ipcMain.handle('generate-summary', async (_event, transcriptPath: string) => {
    try {
      // #150: Validate path is within expected logs directory
      const { resolve } = await import('path')
      const { readFileSync } = await import('fs')
      const logsDir = join(app.getPath('documents'), 'live-translate')
      const resolved = resolve(transcriptPath)
      if (!resolved.startsWith(logsDir)) {
        return { error: 'Invalid transcript path' }
      }
      const transcript = readFileSync(resolved, 'utf-8')

      if (!transcript.trim()) {
        return { error: 'Transcript is empty' }
      }

      // Use SLM translator for summarization
      const slm = new SLMTranslator({
        onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
        kvCacheQuant: store.get('slmKvCacheQuant'),
        modelSize: store.get('slmModelSize')
      })

      try {
        await slm.initialize()
        const summary = await slm.summarize(transcript)
        return { summary }
      } finally {
        await slm.dispose()
      }
    } catch (err) {
      return { error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) }
    }
  })

  // #121: Session management
  ipcMain.handle('list-sessions', () => SessionManager.listSessions())
  ipcMain.handle('load-session', (_event, id: string) => SessionManager.loadSession(id))
  ipcMain.handle('search-sessions', (_event, query: string) => SessionManager.searchSessions(query))
  ipcMain.handle('delete-session', (_event, id: string) => {
    SessionManager.deleteSession(id)
    return { success: true }
  })
  ipcMain.handle('export-session', (_event, id: string, format: 'text' | 'srt' | 'markdown') => {
    const data = SessionManager.loadSession(id)
    if (!data) return { error: 'Session not found' }
    switch (format) {
      case 'srt': return { content: SessionManager.exportAsSRT(data), ext: '.srt' }
      case 'markdown': return { content: SessionManager.exportAsMarkdown(data), ext: '.md' }
      default: return { content: SessionManager.exportAsText(data), ext: '.txt' }
    }
  })

  // --- Model status queries ---

  ipcMain.handle('get-gguf-variants', (_event, modelSize?: SLMModelSize) => {
    const variants = getGGUFVariants(modelSize ?? store.get('slmModelSize'))
    return Object.entries(variants).map(([key, v]) => ({
      key,
      label: v.label,
      filename: v.filename,
      sizeMB: v.sizeMB,
      downloaded: isGGUFDownloaded(v.filename)
    }))
  })

  ipcMain.handle('is-draft-model-available', (_event, _engine?: string) => {
    // TranslateGemma 12B uses 4B as draft model
    const draftVariants = getGGUFVariants('4b')
    const draftVariantConfig = draftVariants['Q4_K_M']
    return draftVariantConfig ? isGGUFDownloaded(draftVariantConfig.filename) : false
  })

  ipcMain.handle('get-hunyuan-mt-variants', () => {
    const variants = getHunyuanMTVariants()
    return Object.entries(variants).map(([key, v]) => ({
      key,
      label: v.label,
      filename: v.filename,
      sizeMB: v.sizeMB,
      downloaded: isGGUFDownloaded(v.filename)
    }))
  })

  ipcMain.handle('get-hunyuan-mt-15-variants', () => {
    const variants = getHunyuanMT15Variants()
    return Object.entries(variants).map(([key, v]) => ({
      key,
      label: v.label,
      filename: v.filename,
      sizeMB: v.sizeMB,
      downloaded: isGGUFDownloaded(v.filename)
    }))
  })

  ipcMain.handle('get-whisper-variants', () => {
    const variants = getWhisperVariants()
    return Object.entries(variants).map(([key, v]) => ({
      key,
      label: v.label,
      description: v.description,
      filename: v.filename,
      sizeMB: v.sizeMB,
      downloaded: isWhisperModelDownloaded(key as WhisperVariant)
    }))
  })

  // --- Misc ---

  ipcMain.handle('list-plugins', () => listPlugins())
  ipcMain.handle('detect-gpu', async () => detectGpu())
  ipcMain.handle('get-platform', () => process.platform)
  ipcMain.handle('get-session-logs', () => store.get('sessionLogs') || [])

  // --- WebSocket Audio Server for Chrome Extension (#264) ---

  ipcMain.handle('ws-audio-start', async (_event, port?: number) => {
    try {
      if (ctx.wsAudioServer?.running) {
        return { error: 'WebSocket audio server is already running' }
      }

      ctx.wsAudioServer = new WsAudioServer(port || store.get('wsAudioPort') || DEFAULT_WS_PORT)

      // Forward received audio to the pipeline
      ctx.wsAudioServer.on('audio', async (chunk: Float32Array) => {
        if (!ctx.pipeline?.running) return

        try {
          await ctx.pipeline.process(chunk, 16000)
        } catch (err) {
          log.error('Pipeline processing error (ws-audio):', err)
        }
      })

      ctx.wsAudioServer.on('connected', () => {
        ctx.mainWindow?.webContents.send('status-update', 'Chrome extension connected')
        ctx.mainWindow?.webContents.send('ws-audio-status', { connected: true, running: true, port: ctx.wsAudioServer?.port })
      })

      ctx.wsAudioServer.on('disconnected', () => {
        ctx.mainWindow?.webContents.send('status-update', 'Chrome extension disconnected')
        ctx.mainWindow?.webContents.send('ws-audio-status', { connected: false, running: ctx.wsAudioServer?.running ?? false, port: ctx.wsAudioServer?.port })
      })

      ctx.wsAudioServer.on('error', (err: Error) => {
        ctx.mainWindow?.webContents.send('status-update', `WebSocket error: ${sanitizeErrorMessage(err.message)}`)
      })

      await ctx.wsAudioServer.start()
      ctx.mainWindow?.webContents.send('ws-audio-status', { connected: false, running: true, port: ctx.wsAudioServer.port })
      return { success: true, port: ctx.wsAudioServer.port }
    } catch (err) {
      return { error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) }
    }
  })

  ipcMain.handle('ws-audio-stop', async () => {
    try {
      if (ctx.wsAudioServer) {
        await ctx.wsAudioServer.stop()
        ctx.wsAudioServer = null
      }
      ctx.mainWindow?.webContents.send('ws-audio-status', { connected: false, running: false, port: null })
      return { success: true }
    } catch (err) {
      return { error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) }
    }
  })

  ipcMain.handle('ws-audio-get-status', () => {
    return {
      running: ctx.wsAudioServer?.running ?? false,
      connected: ctx.wsAudioServer?.hasClient ?? false,
      port: ctx.wsAudioServer?.port ?? store.get('wsAudioPort') ?? DEFAULT_WS_PORT
    }
  })
}
