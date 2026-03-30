import { ipcMain } from 'electron'
import { GoogleTranslator } from '../../engines/translator/GoogleTranslator'
import { DeepLTranslator } from '../../engines/translator/DeepLTranslator'
import { GeminiTranslator } from '../../engines/translator/GeminiTranslator'
import { MicrosoftTranslator } from '../../engines/translator/MicrosoftTranslator'
import { ApiRotationController } from '../../engines/translator/ApiRotationController'
import type { ProviderConfig, QuotaStore } from '../../engines/translator/ApiRotationController'
import { TranscriptLogger } from '../../logger/TranscriptLogger'
import { store } from '../store'
import type { AppContext } from '../app-context'
import type { EngineConfig } from '../../engines/types'
import { sanitizeErrorMessage } from '../error-utils'
import { createLogger } from '../logger'

const log = createLogger('ipc:pipeline')

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

/** Register pipeline control IPC handlers */
export function registerPipelineIpc(ctx: AppContext): void {
  ipcMain.handle('pipeline-start', async (_event, config: PipelineStartConfig) => {
    if (!ctx.pipeline) return { error: 'Pipeline not initialized' }
    if (ctx.pipeline.active) {
      await ctx.pipeline.stop() // Auto-stop before restart
    }

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
}
