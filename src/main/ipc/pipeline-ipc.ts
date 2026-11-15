import { ipcMain } from 'electron'
import { TranscriptLogger } from '../../logger/TranscriptLogger'
import { store } from '../store'
import type { AppContext } from '../app-context'
import type { EngineConfig } from '../../engines/types'
import { sanitizeErrorMessage } from '../error-utils'
import { createLogger } from '../logger'
import { getMdmConfig } from '../mdm-config'
import { selectEngines } from '../../engines/engine-selection'
import { recordSessionEnd } from '../../logger/UsageAnalytics'
import type { LiveSessionMetrics } from '../../logger/UsageAnalytics'

const log = createLogger('ipc:pipeline')

/** Live session metrics for usage analytics — tracks character count in real-time */
let liveMetrics: LiveSessionMetrics | null = null

/**
 * Metadata of the running session, kept in memory so the usage log works even when
 * crash-recovery persistence (activeSession) is off, which is the default.
 */
let runningSession: { engineMode: string; startedAt: number } | null = null

/** Increment character count for the current live session (#519) */
export function trackTranslatedCharacters(charCount: number): void {
  if (liveMetrics && charCount > 0) {
    liveMetrics.characterCount += charCount
  }
}

/** Register pipeline control IPC handlers */
export function registerPipelineIpc(ctx: AppContext): void {
  ipcMain.handle('pipeline-start', async (_event, config: EngineConfig) => {
    if (!ctx.pipeline) return { error: 'Pipeline not initialized' }
    if (ctx.pipeline.active) {
      await ctx.pipeline.stop() // Auto-stop before restart
    }

    try {
      // The app ships one engine per role, so the platform decides them, not the renderer
      // or an MDM engine lock: a stored or locked ID may name an engine that no longer exists.
      const selection = selectEngines(process.platform, process.arch)
      const mdm = getMdmConfig()
      if (mdm.lockedEngine || mdm.lockedSttEngine) {
        log.warn('MDM engine locks are ignored: the app ships a single engine per role')
      }
      config = {
        ...config,
        mode: 'cascade',
        sttEngineId: selection.sttEngine,
        translatorEngineId: selection.translatorEngine
      }

      await ctx.pipeline.switchEngine(config)

      // Load merged glossary (personal + org) from store (#517)
      const personal = store.get('glossaryTerms') || []
      const org = store.get('orgGlossaryTerms') || []
      const { mergeGlossaries } = await import('../../engines/translator/glossary-manager')
      ctx.pipeline!.setGlossary(mergeGlossaries(personal, org))

      // Configure language settings (#263)
      ctx.pipeline!.setLanguageConfig(store.get('sourceLanguage'), store.get('targetLanguage'))

      // Configure SimulMT (#239)
      ctx.pipeline!.setSimulMt(store.get('simulMtEnabled'), store.get('simulMtWaitK'))

      // Configure speaker diarization (#549)
      ctx.pipeline!.setDiarizationEnabled(store.get('speakerDiarizationEnabled'))

      // Transcripts contain meeting content: written to disk only when the user opted in.
      if (store.get('saveTranscripts')) {
        ctx.logger = new TranscriptLogger((msg) => ctx.mainWindow?.webContents.send('status-update', msg))
        ctx.logger.startSession(`${config.sttEngineId} + ${config.translatorEngineId}`)
      } else {
        ctx.logger = null
      }

      const startedAt = Date.now()
      runningSession = {
        engineMode: String(config.translatorEngineId || config.e2eEngineId || 'unknown'),
        startedAt
      }
      // #62: persist session BEFORE start to avoid crash window — opt-in only
      if (store.get('sessionRecoveryEnabled')) {
        store.set('activeSession', { config: { ...config }, startedAt })
      }

      ctx.pipeline.start()

      // #519: Initialize live session metrics for usage analytics
      liveMetrics = {
        sessionId: String(Date.now()),
        startedAt: Date.now(),
        characterCount: 0,
        engineMode: String(config.translatorEngineId || config.e2eEngineId || 'unknown'),
        sourceLanguage: String(store.get('sourceLanguage') || 'auto'),
        targetLanguage: String(store.get('targetLanguage') || 'en')
      }

      return { success: true }
    } catch (err) {
      return { error: sanitizeErrorMessage(String(err)) }
    }
  })

  ipcMain.handle('pipeline-stop', async () => {
    // #116: log session usage
    if (runningSession) {
      const now = Date.now()
      const logs = store.get('sessionLogs') || []
      logs.push({
        startedAt: runningSession.startedAt,
        endedAt: now,
        engineMode: runningSession.engineMode,
        durationMs: now - runningSession.startedAt,
        errorCount: 0
      })
      // Keep last 100 session logs
      store.set('sessionLogs', logs.slice(-100))
      runningSession = null
    }

    // #519: Record usage analytics before stopping
    if (liveMetrics) {
      try {
        recordSessionEnd(liveMetrics)
      } catch (err) {
        log.warn('Failed to record usage analytics:', err)
      }
      liveMetrics = null
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
