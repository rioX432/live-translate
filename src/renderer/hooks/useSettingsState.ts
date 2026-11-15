import { useState } from 'react'
import type { GlossaryTerm } from '../components/settings/glossary-terms'

function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (msg.includes('timed out')) return 'Failed to start — model loading took too long. Try restarting the app.'
  if (msg.includes('Model not found') || msg.includes('model not found')) return 'Model not found. It may need to be downloaded first.'
  if (msg.includes('permission')) return 'Microphone permission denied. Check System Preferences.'
  if (msg.includes('ENOENT') || msg.includes('No such file')) return 'Required file not found. Try reinstalling the app.'
  return `Unexpected error: ${msg}`
}
import type { UseAudioCaptureReturn } from './useAudioCapture'
import type { UseNoiseSuppressionReturn } from './useNoiseSuppression'
import { useEngineSettings } from './useEngineSettings'
import { useDisplaySettings } from './useDisplaySettings'
import { useSubtitleSettings } from './useSubtitleSettings'
import type { AccessibilityState } from './useSubtitleSettings'
import { useLanguageSettings } from './useLanguageSettings'
import { useSessionSettings } from './useSessionSettings'
import {
  withIpcTimeout,
  buildEngineConfig
} from '../components/settings/shared'
import type {
  DisplayInfo,
  Language,
  SourceLanguage,
  SttEngineType,
  SubtitlePositionType
} from '../components/settings/shared'

export interface SettingsState {
  // Engine (fixed by main; shown read-only)
  sttEngine: SttEngineType
  gpuInfo: { hasGpu: boolean; gpuNames: string[] } | null


  // Display
  displays: DisplayInfo[]
  selectedDisplay: number
  handleDisplayChange: (displayId: number) => void

  // Session
  status: string
  setStatus: (v: string) => void
  isRunning: boolean
  isStarting: boolean
  sessionDuration: string
  sessions: Array<{ id: string; startedAt: number; engineMode: string; entryCount: number }>

  // Language
  sourceLanguage: SourceLanguage
  setSourceLanguage: (v: SourceLanguage) => void
  targetLanguage: Language
  setTargetLanguage: (v: Language) => void

  // Speaker diarization (#549)
  speakerDiarizationEnabled: boolean
  setSpeakerDiarizationEnabled: (v: boolean) => void

  // Subtitle
  subtitleFontSize: number
  setSubtitleFontSize: (v: number) => void
  subtitleSourceColor: string
  setSubtitleSourceColor: (v: string) => void
  subtitleTranslatedColor: string
  setSubtitleTranslatedColor: (v: string) => void
  subtitleBgOpacity: number
  setSubtitleBgOpacity: (v: number) => void
  subtitlePosition: SubtitlePositionType
  setSubtitlePosition: (v: SubtitlePositionType) => void
  showConfidenceIndicator: boolean
  setShowConfidenceIndicator: (v: boolean) => void

  // Accessibility
  accessibility: AccessibilityState

  // SimulMT
  simulMtEnabled: boolean
  setSimulMtEnabled: (v: boolean) => void
  simulMtWaitK: number
  setSimulMtWaitK: (v: number) => void

  // Glossary
  glossaryTerms: GlossaryTerm[]
  setGlossaryTerms: (v: GlossaryTerm[]) => void
  orgGlossaryTerms: GlossaryTerm[]
  setOrgGlossaryTerms: (v: GlossaryTerm[]) => void


  // Platform
  platform: string

  // Meeting summary
  lastTranscriptPath: string | null
  summaryText: string | null
  isSummarizing: boolean

  // Crash recovery
  crashedSession: { config: Record<string, unknown>; startedAt: number } | null

  // UI state
  showAdvanced: boolean
  setShowAdvanced: (v: boolean) => void

  // Audio + noise suppression
  audio: UseAudioCaptureReturn
  noiseSuppression: UseNoiseSuppressionReturn
  streamingIntervalMs: number
  setStreamingIntervalMs: (v: number) => void

  // Actions
  handleStart: () => Promise<void>
  handleStop: () => Promise<void>
  handleResume: () => Promise<void>
  handleDismissResume: () => void
  pushSubtitleSettings: (overrides?: Record<string, unknown>) => void
  handleGenerateSummary: () => Promise<void>
}

export function useSettingsState(): SettingsState {
  // UI state (trivial, kept in composer)
  const [showAdvanced, setShowAdvanced] = useState(false)

  // Domain-specific hooks
  const engine = useEngineSettings()
  const display = useDisplaySettings()
  const subtitle = useSubtitleSettings()
  const language = useLanguageSettings()
  const session = useSessionSettings()

  // --- Actions ---
  const handleStart = async (): Promise<void> => {
    if (session.isStarting) return
    session.setIsStarting(true)

    try {
      session.setStatus('Starting pipeline...')

      await withIpcTimeout(window.api.saveSettings({
        selectedMicrophone: session.audio.selectedDevice,
        selectedDisplay: display.selectedDisplay,
        simulMtEnabled: engine.simulMtEnabled,
        simulMtWaitK: engine.simulMtWaitK,
        sourceLanguage: language.sourceLanguage,
        targetLanguage: language.targetLanguage,
        noiseSuppressionEnabled: session.noiseSuppression.enabled,
        audioSource: session.audio.audioSource,
        speakerDiarizationEnabled: language.speakerDiarizationEnabled,
        streamingIntervalMs: session.streamingIntervalMs
      }), 10_000, 'saveSettings')

      const config = buildEngineConfig(engine.sttEngine)

      const result = await withIpcTimeout(window.api.pipelineStart(config), 120_000, 'pipelineStart')
      if (result.error) {
        session.setStatus(`Error: ${result.error}`)
        session.setIsStarting(false)
        return
      }

      await session.audio.start()
      session.setIsRunning(true)
      session.startSessionTimer()
      session.setStatus('Listening...')
    } catch (err) {
      session.setStatus(friendlyError(err))
      session.setIsRunning(false)
      session.stopSessionTimer()
    } finally {
      session.setIsStarting(false)
    }
  }

  const handleStop = async (): Promise<void> => {
    try {
      session.audio.stop()
      session.stopSessionTimer()
      const result = await withIpcTimeout(window.api.pipelineStop(), 10_000, 'pipelineStop')
      session.setStatus(result.logPath ? `Saved: ${result.logPath}` : 'Stopped')

      if (result.logPath) {
        session.setLastTranscriptPath(result.logPath)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      session.setStatus(`Stop error: ${msg}`)
    } finally {
      session.setIsRunning(false)
    }
  }

  const handleResume = async (): Promise<void> => {
    if (!session.crashedSession || session.isStarting) return
    session.setIsStarting(true)

    try {
      session.setStatus('Resuming previous session...')
      const result = await withIpcTimeout(window.api.pipelineStart(session.crashedSession.config), 120_000, 'pipelineStart')
      if (result.error) {
        session.setStatus(`Resume failed: ${result.error}`)
        session.setIsStarting(false)
        return
      }
      await session.audio.start()
      session.setIsRunning(true)
      session.setCrashedSession(null)
      session.startSessionTimer()
      session.setStatus('Listening... (resumed)')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      session.setStatus(`Resume failed: ${msg}`)
      session.setIsRunning(false)
      session.audio.stop()
      session.stopSessionTimer()
    } finally {
      session.setIsStarting(false)
    }
  }

  const handleDismissResume = (): void => {
    session.setCrashedSession(null)
    session.setStatus('Ready')
  }

  const handleGenerateSummary = async (): Promise<void> => {
    if (!session.lastTranscriptPath) return
    session.setIsSummarizing(true)
    session.setStatus('Generating meeting summary...')
    const result = await withIpcTimeout(window.api.generateSummary(session.lastTranscriptPath), 120_000, 'generateSummary')
    session.setIsSummarizing(false)
    if (result.summary) {
      session.setSummaryText(result.summary)
      session.setStatus('Summary generated')
    } else {
      session.setStatus(`Summary failed: ${result.error}`)
    }
  }

  return {
    // Engine
    sttEngine: engine.sttEngine,
    gpuInfo: engine.gpuInfo,
    simulMtEnabled: engine.simulMtEnabled, setSimulMtEnabled: engine.setSimulMtEnabled,
    simulMtWaitK: engine.simulMtWaitK, setSimulMtWaitK: engine.setSimulMtWaitK,
    glossaryTerms: engine.glossaryTerms, setGlossaryTerms: engine.setGlossaryTerms,
    orgGlossaryTerms: engine.orgGlossaryTerms, setOrgGlossaryTerms: engine.setOrgGlossaryTerms,

    // Display
    displays: display.displays, selectedDisplay: display.selectedDisplay,
    handleDisplayChange: display.handleDisplayChange,

    // Subtitle
    subtitleFontSize: subtitle.subtitleFontSize, setSubtitleFontSize: subtitle.setSubtitleFontSize,
    subtitleSourceColor: subtitle.subtitleSourceColor, setSubtitleSourceColor: subtitle.setSubtitleSourceColor,
    subtitleTranslatedColor: subtitle.subtitleTranslatedColor, setSubtitleTranslatedColor: subtitle.setSubtitleTranslatedColor,
    subtitleBgOpacity: subtitle.subtitleBgOpacity, setSubtitleBgOpacity: subtitle.setSubtitleBgOpacity,
    subtitlePosition: subtitle.subtitlePosition, setSubtitlePosition: subtitle.setSubtitlePosition,
    showConfidenceIndicator: subtitle.showConfidenceIndicator, setShowConfidenceIndicator: subtitle.setShowConfidenceIndicator,
    accessibility: subtitle.accessibility,
    pushSubtitleSettings: subtitle.pushSubtitleSettings,

    // Language
    sourceLanguage: language.sourceLanguage, setSourceLanguage: language.setSourceLanguage,
    targetLanguage: language.targetLanguage, setTargetLanguage: language.setTargetLanguage,
    platform: language.platform,
    speakerDiarizationEnabled: language.speakerDiarizationEnabled, setSpeakerDiarizationEnabled: language.setSpeakerDiarizationEnabled,

    // Session
    status: session.status, setStatus: session.setStatus,
    isRunning: session.isRunning, isStarting: session.isStarting,
    sessionDuration: session.sessionDuration,
    sessions: session.sessions,
    lastTranscriptPath: session.lastTranscriptPath,
    summaryText: session.summaryText,
    isSummarizing: session.isSummarizing,
    crashedSession: session.crashedSession,

    // Audio + noise suppression
    audio: session.audio, noiseSuppression: session.noiseSuppression,
    streamingIntervalMs: session.streamingIntervalMs, setStreamingIntervalMs: session.setStreamingIntervalMs,

    // UI state
    showAdvanced, setShowAdvanced,

    // Actions
    handleStart, handleStop, handleResume, handleDismissResume,
    handleGenerateSummary
  }
}
