import { app, BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { TranslationPipeline } from '../pipeline/TranslationPipeline'
import { WhisperLocalEngine } from '../engines/stt/WhisperLocalEngine'
import { MlxWhisperEngine } from '../engines/stt/MlxWhisperEngine'
import { MoonshineEngine } from '../engines/stt/MoonshineEngine'
import { GoogleTranslator } from '../engines/translator/GoogleTranslator'
import { DeepLTranslator } from '../engines/translator/DeepLTranslator'
import { GeminiTranslator } from '../engines/translator/GeminiTranslator'
import { MicrosoftTranslator } from '../engines/translator/MicrosoftTranslator'
import { OpusMTTranslator } from '../engines/translator/OpusMTTranslator'
import { CT2OpusMTTranslator } from '../engines/translator/CT2OpusMTTranslator'
import { ApiRotationController } from '../engines/translator/ApiRotationController'
import type { ProviderConfig, QuotaStore } from '../engines/translator/ApiRotationController'
import { SLMTranslator } from '../engines/translator/SLMTranslator'
import { HunyuanMTTranslator } from '../engines/translator/HunyuanMTTranslator'
import { HybridTranslator } from '../engines/translator/HybridTranslator'
import { detectGpu } from '../engines/gpu-detector'
import { isGGUFDownloaded, getGGUFVariants, getHunyuanMTVariants } from '../engines/model-downloader'
import type { SLMModelSize } from '../engines/model-downloader'
import { listPlugins, discoverPlugins, loadPluginEngine } from '../engines/plugin-loader'
import { TranscriptLogger } from '../logger/TranscriptLogger'
import * as SessionManager from '../logger/SessionManager'
import { store } from './store'
import type { EngineConfig, TranslationResult } from '../engines/types'

/** Scrub API keys from error messages before sending to renderer (#209) */
function sanitizeErrorMessage(message: string): string {
  const settings = store.store as Record<string, unknown>
  const secrets = [
    settings.googleApiKey,
    settings.deeplApiKey,
    settings.geminiApiKey,
    settings.microsoftApiKey
  ].filter((s): s is string => typeof s === 'string' && s.length > 8)

  let sanitized = message
  for (const secret of secrets) {
    sanitized = sanitized.split(secret).join('***')
  }
  // Also scrub common API key patterns that may leak from HTTP responses
  sanitized = sanitized.replace(/AIza[0-9A-Za-z\-_]{35}/g, '***')
  return sanitized
}

/** Minimum amplitude to consider a chunk as non-silent */
const SILENCE_THRESHOLD = 0.001

/** Calculate subtitle window height based on display scale factor */
function getSubtitleHeight(display: Electron.Display): number {
  // Base height for 3 subtitle lines at default font size (30px)
  const baseHeight = 200
  const scaleFactor = display.scaleFactor ?? 1
  // Scale for HiDPI displays but cap at 2x to avoid excessively tall windows
  return Math.round(baseHeight * Math.min(scaleFactor, 2))
}

/** Monthly character limits for API rotation providers */
const QUOTA_LIMITS = {
  microsoft: 2_000_000,
  google: 480_000,
  deepl: 500_000,
  gemini: 1_000_000
} as const

let mainWindow: BrowserWindow | null = null
let subtitleWindow: BrowserWindow | null = null
let pipeline: TranslationPipeline | null = null
let logger: TranscriptLogger | null = null

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 480,
    minHeight: 600,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    subtitleWindow?.close()
  })
}

function createSubtitleWindow(): void {
  const displays = screen.getAllDisplays()
  const savedDisplayId = store.get('selectedDisplay')
  const savedDisplay = savedDisplayId ? displays.find((d) => d.id === savedDisplayId) : null
  const primaryId = screen.getPrimaryDisplay().id
  const externalDisplay = displays.find((d) => d.id !== primaryId)
  const targetDisplay = savedDisplay || externalDisplay || displays[0]

  const subtitleHeight = getSubtitleHeight(targetDisplay)
  subtitleWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y + targetDisplay.bounds.height - subtitleHeight,
    width: targetDisplay.bounds.width,
    height: subtitleHeight,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  subtitleWindow.setIgnoreMouseEvents(true, { forward: true })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    subtitleWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/subtitle`)
  } else {
    subtitleWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/subtitle' })
  }

  subtitleWindow.on('closed', () => {
    subtitleWindow = null
  })
}

function initPipeline(): void {
  pipeline = new TranslationPipeline()

  // Register STT engines
  pipeline.registerSTT('whisper-local', () => new WhisperLocalEngine({
    onProgress: (msg) => mainWindow?.webContents.send('status-update', msg)
  }))
  // mlx-whisper is Apple Silicon only — skip registration on other platforms
  if (process.platform === 'darwin') {
    pipeline.registerSTT('mlx-whisper', () => new MlxWhisperEngine({
      onProgress: (msg) => mainWindow?.webContents.send('status-update', msg)
    }))
  }
  pipeline.registerSTT('moonshine', () => new MoonshineEngine({
    onProgress: (msg) => mainWindow?.webContents.send('status-update', msg)
  }))

  // Register translator engines
  pipeline.registerTranslator('opus-mt', () => new OpusMTTranslator({
    onProgress: (msg) => mainWindow?.webContents.send('status-update', msg)
  }))
  pipeline.registerTranslator('ct2-opus-mt', () => new CT2OpusMTTranslator({
    onProgress: (msg) => mainWindow?.webContents.send('status-update', msg)
  }))
  pipeline.registerTranslator('slm-translate', () => new SLMTranslator({
    onProgress: (msg) => mainWindow?.webContents.send('status-update', msg),
    kvCacheQuant: store.get('slmKvCacheQuant'),
    modelSize: store.get('slmModelSize'),
    speculativeDecoding: store.get('slmSpeculativeDecoding')
  }))
  pipeline.registerTranslator('hunyuan-mt', () => new HunyuanMTTranslator({
    onProgress: (msg) => mainWindow?.webContents.send('status-update', msg),
    kvCacheQuant: store.get('slmKvCacheQuant')
  }))
  // Hybrid translator: OPUS-MT instant draft + TranslateGemma refinement (#235)
  pipeline.registerTranslator('hybrid', () => new HybridTranslator(
    new OpusMTTranslator({
      onProgress: (msg) => mainWindow?.webContents.send('status-update', msg)
    }),
    new SLMTranslator({
      onProgress: (msg) => mainWindow?.webContents.send('status-update', msg),
      kvCacheQuant: store.get('slmKvCacheQuant'),
      modelSize: store.get('slmModelSize'),
      speculativeDecoding: store.get('slmSpeculativeDecoding')
    })
  ))
  // Auto-register discovered plugins (#145)
  for (const plugin of discoverPlugins()) {
    const { manifest } = plugin
    const factory = () => loadPluginEngine(plugin)
    if (manifest.engineType === 'stt') {
      pipeline.registerSTT(manifest.engineId, factory as any)
    } else if (manifest.engineType === 'translator') {
      pipeline.registerTranslator(manifest.engineId, factory as any)
    } else if (manifest.engineType === 'e2e') {
      pipeline.registerE2E(manifest.engineId, factory as any)
    }
    console.log(`[plugin] Registered ${manifest.engineType} plugin: ${manifest.name} (${manifest.engineId})`)
  }
  // GoogleTranslator needs API key — registered dynamically when user provides one

  // Forward results to subtitle window and logger
  pipeline.on('result', (result: TranslationResult) => {
    subtitleWindow?.webContents.send('translation-result', result)
    mainWindow?.webContents.send('translation-result', result)
    logger?.log(result)
  })

  // Forward interim (streaming) results to subtitle window
  pipeline.on('interim-result', (result: TranslationResult) => {
    subtitleWindow?.webContents.send('interim-result', result)
    mainWindow?.webContents.send('interim-result', result)
  })

  // Forward draft results from hybrid translation (#235)
  pipeline.on('draft-result', (result: TranslationResult) => {
    subtitleWindow?.webContents.send('draft-result', result)
    mainWindow?.webContents.send('draft-result', result)
  })

  pipeline.on('error', (err: Error) => {
    const msg = sanitizeErrorMessage(err.message)
    const hint = getErrorHint(msg)
    mainWindow?.webContents.send('status-update', `Error: ${msg}${hint}`)
  })

  pipeline.on('engine-loading', (msg: string) => {
    mainWindow?.webContents.send('status-update', msg)
  })

  pipeline.on('engine-ready', () => {
    mainWindow?.webContents.send('status-update', 'Engine ready')
  })
}

// --- IPC Handlers ---

// Start pipeline with given config
interface PipelineStartConfig extends EngineConfig {
  apiKey?: string
  deeplApiKey?: string
  geminiApiKey?: string
  microsoftApiKey?: string
  microsoftRegion?: string
}

ipcMain.handle('pipeline-start', async (_event, config: PipelineStartConfig) => {
  if (!pipeline) return { error: 'Pipeline not initialized' }
  if (pipeline.active) return { error: 'Pipeline already running' } // #30

  try {
    // Register online translators with provided API keys
    if (config.apiKey) {
      pipeline.registerTranslator('google-translate', () => new GoogleTranslator(config.apiKey!))
    }
    if (config.deeplApiKey) {
      pipeline.registerTranslator('deepl-translate', () => new DeepLTranslator(config.deeplApiKey!))
    }
    if (config.geminiApiKey) {
      pipeline.registerTranslator('gemini-translate', () => new GeminiTranslator(config.geminiApiKey!))
    }
    if (config.microsoftApiKey && config.microsoftRegion) {
      pipeline.registerTranslator('microsoft-translate', () =>
        new MicrosoftTranslator(config.microsoftApiKey!, config.microsoftRegion!)
      )
    }

    // Build rotation controller when rotation mode is selected
    let rotationProviders: ProviderConfig[] | null = null
    if (config.translatorEngineId === 'rotation-controller') {
      rotationProviders = []
      const statusFn = (msg: string): void => {
        mainWindow?.webContents.send('status-update', msg)
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

      pipeline.registerTranslator('rotation-controller', () =>
        new ApiRotationController(rotationProviders!, persistence, statusFn)
      )
    }

    try {
      await pipeline.switchEngine(config)
    } catch (err) {
      // Dispose leaked rotation provider instances on switchEngine failure
      if (rotationProviders) {
        for (const p of rotationProviders) {
          p.engine.dispose().catch(() => {})
        }
      }
      throw err
    }

    // Load glossary terms from store
    const glossaryTerms = store.get('glossaryTerms') || []
    pipeline!.setGlossary(glossaryTerms)

    // Configure SimulMT (#239)
    pipeline!.setSimulMt(store.get('simulMtEnabled'), store.get('simulMtWaitK'))

    // Start logger
    logger = new TranscriptLogger((msg) => mainWindow?.webContents.send('status-update', msg))
    const sessionLabel = config.mode === 'e2e'
      ? 'Offline (Whisper Translate)'
      : `Cascade (Whisper + ${config.translatorEngineId})`
    logger.startSession(sessionLabel)

    // #62: persist session BEFORE start to avoid crash window
    store.set('activeSession', { config, startedAt: Date.now() })

    pipeline.start()

    return { success: true }
  } catch (err) {
    return { error: sanitizeErrorMessage(String(err)) }
  }
})

// Stop pipeline
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

  await pipeline?.stop()
  logger?.endSession()
  const logPath = logger?.getLogPath()
  logger = null
  // #54: clear session on clean stop
  store.set('activeSession', null)
  return { logPath }
})

// Get session start time
ipcMain.handle('get-session-start-time', () => {
  return pipeline?.sessionStartTime ?? null
})

/** Map error patterns to actionable hints */
function getErrorHint(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('api key') || lower.includes('401') || lower.includes('403')) {
    return ' — Check your API key in settings'
  }
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('quota')) {
    return ' — API quota exceeded, try a different provider'
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return ' — Check your internet connection'
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return ' — Check your internet connection'
  }
  if (lower.includes('model') || lower.includes('download')) {
    return ' — Model download issue, try restarting'
  }
  return ''
}

/** Convert IPC audio data to Float32Array */
function toFloat32Array(audioData: unknown): Float32Array | null {
  let chunk: Float32Array
  if (audioData instanceof Float32Array) {
    chunk = audioData
  } else if (Array.isArray(audioData)) {
    chunk = new Float32Array(audioData)
  } else if (audioData instanceof ArrayBuffer || Buffer.isBuffer(audioData)) {
    chunk = new Float32Array(
      Buffer.isBuffer(audioData) ? audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength) : audioData
    )
  } else {
    console.error('[audio] Unknown data type:', typeof audioData)
    return null
  }

  // Scan for max amplitude (used for silence detection)
  let maxAmp = 0
  for (let i = 0; i < chunk.length; i++) {
    const abs = Math.abs(chunk[i])
    if (abs > maxAmp) maxAmp = abs
  }

  if (maxAmp < SILENCE_THRESHOLD) {
    return null
  }

  return chunk
}

// Process audio chunk from renderer
ipcMain.handle('process-audio', async (_event, audioData: unknown) => {
  if (!pipeline?.running) return null

  const chunk = toFloat32Array(audioData)
  if (!chunk || chunk.length < 8000) return null

  try {
    return await pipeline.process(chunk, 16000)
  } catch (err) {
    console.error('[audio] Pipeline error:', err)
    // #43: propagate error to renderer
    const message = sanitizeErrorMessage(err instanceof Error ? err.message : String(err))
    mainWindow?.webContents.send('status-update', `Processing error: ${message}`)
    return null
  }
})

// Process streaming audio (rolling buffer during speech)
ipcMain.handle('process-audio-streaming', async (_event, audioData: unknown) => {
  if (!pipeline?.running) return null

  const chunk = toFloat32Array(audioData)
  if (!chunk || chunk.length < 8000) return null

  try {
    return await pipeline.processStreaming(chunk, 16000)
  } catch (err) {
    console.error('[audio] Streaming pipeline error:', err)
    return null
  }
})

// Finalize streaming (speech segment ended)
ipcMain.handle('finalize-streaming', async (_event, audioData: unknown) => {
  if (!pipeline?.running) return null

  const chunk = toFloat32Array(audioData)
  if (!chunk || chunk.length < 8000) return null

  try {
    return await pipeline.finalizeStreaming(chunk, 16000)
  } catch (err) {
    console.error('[audio] Finalize streaming error:', err)
    return null
  }
})

// Get available displays
ipcMain.handle('get-displays', () => {
  const primary = screen.getPrimaryDisplay()
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.id === primary.id ? `Display ${i + 1} (Main)` : `Display ${i + 1} (External)`,
    bounds: d.bounds
  }))
})

// Move subtitle window to target display
ipcMain.on('move-subtitle-to-display', (_event, displayId: number) => {
  const display = screen.getAllDisplays().find((d) => d.id === displayId)
  if (!display) {
    console.warn(`[display] Display ${displayId} not found, ignoring move request`)
    return
  }
  if (subtitleWindow) {
    const h = getSubtitleHeight(display)
    subtitleWindow.setBounds({
      x: display.bounds.x,
      y: display.bounds.y + display.bounds.height - h,
      width: display.bounds.width,
      height: h
    })
  }
})

// Forward translation result to subtitle window (from renderer)
ipcMain.on('translation-result', (_event, data) => {
  subtitleWindow?.webContents.send('translation-result', data)
})

// Settings persistence via electron-store (#49)
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
    simulMtWaitK: store.get('simulMtWaitK')
  }
})

// Subtitle settings — push changes to subtitle window in real-time
ipcMain.handle('save-subtitle-settings', (_event, settings: Record<string, unknown>) => {
  store.set('subtitleSettings', settings as import('./store').SubtitleSettings)
  subtitleWindow?.webContents.send('subtitle-settings-changed', settings)
})

ipcMain.handle('save-settings', (_event, settings: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(settings)) {
    store.set(key as keyof import('./store').AppSettings, value as never)
  }
})

// Glossary terms persistence (#240)
ipcMain.handle('save-glossary', (_event, terms: Array<{ source: string; target: string }>) => {
  store.set('glossaryTerms', terms)
  // Update running pipeline glossary in real-time
  if (pipeline) {
    pipeline.setGlossary(terms)
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
    console.warn('[crash-recovery] Invalid session config, discarding:', config)
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
      onProgress: (msg) => mainWindow?.webContents.send('status-update', msg),
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

// #133: GGUF model status
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

// #238: Check if draft model (4B) is available for speculative decoding
ipcMain.handle('is-draft-model-available', () => {
  const draftVariants = getGGUFVariants('4b')
  const draftVariantConfig = draftVariants['Q4_K_M']
  return draftVariantConfig ? isGGUFDownloaded(draftVariantConfig.filename) : false
})

// #234: Hunyuan-MT GGUF model status
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

// #127: List installed engine plugins
ipcMain.handle('list-plugins', () => listPlugins())

// #132: GPU detection for engine auto-selection
ipcMain.handle('detect-gpu', async () => {
  return detectGpu()
})

// #243: Platform info for renderer to hide platform-specific options
ipcMain.handle('get-platform', () => process.platform)

// #116: Get session usage logs for feedback collection
ipcMain.handle('get-session-logs', () => {
  return store.get('sessionLogs') || []
})

// --- App Lifecycle ---

app.whenReady().then(() => {
  initPipeline()
  createMainWindow()
  createSubtitleWindow()

  // #46: reposition subtitle window when external display is disconnected
  screen.on('display-removed', () => {
    if (!subtitleWindow) return
    const primaryDisplay = screen.getPrimaryDisplay()
    const h = getSubtitleHeight(primaryDisplay)
    subtitleWindow.setBounds({
      x: primaryDisplay.bounds.x,
      y: primaryDisplay.bounds.y + primaryDisplay.bounds.height - h,
      width: primaryDisplay.bounds.width,
      height: h
    })
    // #64: notify renderer to refresh display list
    mainWindow?.webContents.send('displays-changed')
  })

  screen.on('display-added', () => {
    mainWindow?.webContents.send('displays-changed')
  })
})

let isQuitting = false
app.on('before-quit', (event) => {
  if (isQuitting) return
  isQuitting = true
  event.preventDefault()

  // Async cleanup before quit — timeout after 5s to prevent hanging (#222)
  ;(async () => {
    try {
      logger?.endSession()
      logger = null
      store.set('activeSession', null)
      await Promise.race([
        pipeline?.dispose() ?? Promise.resolve(),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('Cleanup timed out')), 5000)
        )
      ])
    } catch (err) {
      console.error('[quit] Cleanup error:', err)
    } finally {
      app.quit()
    }
  })()
})

app.on('window-all-closed', () => {
  app.quit()
})

