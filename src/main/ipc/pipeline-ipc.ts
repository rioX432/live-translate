import { ipcMain } from 'electron'
import { TranscriptLogger } from '../../logger/TranscriptLogger'
import { store } from '../store'
import type { AppContext } from '../app-context'
import type { EngineConfig } from '../../engines/types'
import { sanitizeErrorMessage } from '../error-utils'
import { createLogger } from '../logger'
import { getMdmConfig } from '../mdm-config'
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
      // #519: Apply MDM admin locks — override user-selected engine if locked
      const mdm = getMdmConfig()
      if (mdm.lockedEngine && config.translatorEngineId) {
        log.info(`MDM: Overriding translator engine from ${config.translatorEngineId} to ${mdm.lockedEngine}`)
        config.translatorEngineId = mdm.lockedEngine
      }
      if (mdm.lockedSttEngine && config.sttEngineId) {
        log.info(`MDM: Overriding STT engine from ${config.sttEngineId} to ${mdm.lockedSttEngine}`)
        config.sttEngineId = mdm.lockedSttEngine
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

      // Configure draft STT (#536)
      ctx.pipeline!.setDraftSttEnabled(store.get('draftSttEnabled'))

      // Configure speaker diarization (#549)
      ctx.pipeline!.setDiarizationEnabled(store.get('speakerDiarizationEnabled'))

      // Transcripts contain meeting content: written to disk only when the user opted in.
      if (store.get('saveTranscripts')) {
        ctx.logger = new TranscriptLogger((msg) => ctx.mainWindow?.webContents.send('status-update', msg))
        const sessionLabel = config.mode === 'e2e'
          ? 'Offline (Whisper Translate)'
          : `Cascade (Whisper + ${config.translatorEngineId})`
        ctx.logger.startSession(sessionLabel)
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
