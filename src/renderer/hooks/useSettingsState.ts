import { useState } from 'react'
import type { UseAudioCaptureReturn } from './useAudioCapture'
import type { UseNoiseSuppressionReturn } from './useNoiseSuppression'
import { useEngineSettings } from './useEngineSettings'
import { useDisplaySettings } from './useDisplaySettings'
import { useSubtitleSettings } from './useSubtitleSettings'
import { useLanguageSettings } from './useLanguageSettings'
import { useSessionSettings } from './useSessionSettings'
import {
  withIpcTimeout,
  resolveEngineMode,
  buildEngineConfig
} from '../components/settings/shared'
import type {
  DisplayInfo,
  EngineMode,
  Language,
  SourceLanguage,
  SttEngineType,
  SubtitlePositionType,
  WhisperVariantType
} from '../components/settings/shared'

export interface SettingsState {
  // Engine
  engineMode: EngineMode
  setEngineMode: (v: EngineMode) => void
  gpuInfo: { hasGpu: boolean; gpuNames: string[] } | null

  // API keys
  apiKey: string
  setApiKey: (v: string) => void
  deeplApiKey: string
  setDeeplApiKey: (v: string) => void
  geminiApiKey: string
  setGeminiApiKey: (v: string) => void
  microsoftApiKey: string
  setMicrosoftApiKey: (v: string) => void
  microsoftRegion: string
  setMicrosoftRegion: (v: string) => void

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

  // STT
  sttEngine: SttEngineType
  setSttEngine: (v: SttEngineType) => void
  whisperVariant: WhisperVariantType
  setWhisperVariant: (v: WhisperVariantType) => void

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

  // SLM options
  slmKvCacheQuant: boolean
  setSlmKvCacheQuant: (v: boolean) => void
  simulMtEnabled: boolean
  setSimulMtEnabled: (v: boolean) => void
  simulMtWaitK: number
  setSimulMtWaitK: (v: number) => void

  // Glossary
  glossaryTerms: Array<{ source: string; target: string }>
  setGlossaryTerms: (v: Array<{ source: string; target: string }>) => void

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
  showApiOptions: boolean
  setShowApiOptions: (v: boolean) => void

  // Audio + noise suppression
  audio: UseAudioCaptureReturn
  noiseSuppression: UseNoiseSuppressionReturn

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
  const [showApiOptions, setShowApiOptions] = useState(false)

  // Domain-specific hooks
  const engine = useEngineSettings({ setShowAdvanced, setShowApiOptions })
  const display = useDisplaySettings()
  const subtitle = useSubtitleSettings()
  const language = useLanguageSettings()
  const session = useSessionSettings()

  // --- Actions ---
  const apiKeys = {
    apiKey: engine.apiKey,
    deeplApiKey: engine.deeplApiKey,
    geminiApiKey: engine.geminiApiKey,
    microsoftApiKey: engine.microsoftApiKey,
    microsoftRegion: engine.microsoftRegion
  }

  const handleStart = async (): Promise<void> => {
    if (session.isStarting) return
    session.setIsStarting(true)

    try {
      session.setStatus('Starting pipeline...')

      await withIpcTimeout(window.api.saveSettings({
        translationEngine: engine.engineMode,
        googleApiKey: engine.apiKey,
        deeplApiKey: engine.deeplApiKey,
        geminiApiKey: engine.geminiApiKey,
        microsoftApiKey: engine.microsoftApiKey,
        microsoftRegion: engine.microsoftRegion,
        selectedMicrophone: session.audio.selectedDevice,
        selectedDisplay: display.selectedDisplay,
        sttEngine: language.sttEngine,
        whisperVariant: language.whisperVariant,
        slmKvCacheQuant: engine.slmKvCacheQuant,
        simulMtEnabled: engine.simulMtEnabled,
        simulMtWaitK: engine.simulMtWaitK,
        sourceLanguage: language.sourceLanguage,
        targetLanguage: language.targetLanguage,
        noiseSuppressionEnabled: session.noiseSuppression.enabled
      }), 10_000, 'saveSettings')

      const resolvedMode = resolveEngineMode(engine.engineMode, apiKeys, engine.gpuInfo)
      const config = buildEngineConfig(resolvedMode, language.sttEngine, apiKeys)

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
      session.setStatus(`Error: ${err}`)
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
      session.setStatus(`Stop error: ${err}`)
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
      session.setStatus(`Resume failed: ${err}`)
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
    engineMode: engine.engineMode, setEngineMode: engine.setEngineMode,
    gpuInfo: engine.gpuInfo,
    apiKey: engine.apiKey, setApiKey: engine.setApiKey,
    deeplApiKey: engine.deeplApiKey, setDeeplApiKey: engine.setDeeplApiKey,
    geminiApiKey: engine.geminiApiKey, setGeminiApiKey: engine.setGeminiApiKey,
    microsoftApiKey: engine.microsoftApiKey, setMicrosoftApiKey: engine.setMicrosoftApiKey,
    microsoftRegion: engine.microsoftRegion, setMicrosoftRegion: engine.setMicrosoftRegion,
    slmKvCacheQuant: engine.slmKvCacheQuant, setSlmKvCacheQuant: engine.setSlmKvCacheQuant,
    simulMtEnabled: engine.simulMtEnabled, setSimulMtEnabled: engine.setSimulMtEnabled,
    simulMtWaitK: engine.simulMtWaitK, setSimulMtWaitK: engine.setSimulMtWaitK,
    glossaryTerms: engine.glossaryTerms, setGlossaryTerms: engine.setGlossaryTerms,

    // Display
    displays: display.displays, selectedDisplay: display.selectedDisplay,
    handleDisplayChange: display.handleDisplayChange,

    // Subtitle
    subtitleFontSize: subtitle.subtitleFontSize, setSubtitleFontSize: subtitle.setSubtitleFontSize,
    subtitleSourceColor: subtitle.subtitleSourceColor, setSubtitleSourceColor: subtitle.setSubtitleSourceColor,
    subtitleTranslatedColor: subtitle.subtitleTranslatedColor, setSubtitleTranslatedColor: subtitle.setSubtitleTranslatedColor,
    subtitleBgOpacity: subtitle.subtitleBgOpacity, setSubtitleBgOpacity: subtitle.setSubtitleBgOpacity,
    subtitlePosition: subtitle.subtitlePosition, setSubtitlePosition: subtitle.setSubtitlePosition,
    pushSubtitleSettings: subtitle.pushSubtitleSettings,

    // Language
    sourceLanguage: language.sourceLanguage, setSourceLanguage: language.setSourceLanguage,
    targetLanguage: language.targetLanguage, setTargetLanguage: language.setTargetLanguage,
    sttEngine: language.sttEngine, setSttEngine: language.setSttEngine,
    whisperVariant: language.whisperVariant, setWhisperVariant: language.setWhisperVariant,
    platform: language.platform,

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

    // UI state
    showAdvanced, setShowAdvanced,
    showApiOptions, setShowApiOptions,

    // Actions
    handleStart, handleStop, handleResume, handleDismissResume,
    handleGenerateSummary
  }
}
