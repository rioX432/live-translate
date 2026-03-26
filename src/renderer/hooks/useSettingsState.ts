import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioCapture } from './useAudioCapture'
import { useNoiseSuppression } from './useNoiseSuppression'
import type { UseAudioCaptureReturn } from './useAudioCapture'
import type { UseNoiseSuppressionReturn } from './useNoiseSuppression'
import {
  API_ENGINE_MODES,
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
  const [engineMode, setEngineMode] = useState<EngineMode>('offline-opus')
  const [gpuInfo, setGpuInfo] = useState<{ hasGpu: boolean; gpuNames: string[] } | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [deeplApiKey, setDeeplApiKey] = useState('')
  const [geminiApiKey, setGeminiApiKey] = useState('')
  const [microsoftApiKey, setMicrosoftApiKey] = useState('')
  const [microsoftRegion, setMicrosoftRegion] = useState('')
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [selectedDisplay, setSelectedDisplay] = useState<number>(0)
  const [status, setStatus] = useState('Ready')
  const [isRunning, setIsRunning] = useState(false)
  const [sessionDuration, setSessionDuration] = useState('')
  const sessionTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const sessionStartRef = useRef<number | null>(null)

  const [isStarting, setIsStarting] = useState(false)

  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>('auto')
  const [targetLanguage, setTargetLanguage] = useState<Language>('en')

  const [sttEngine, setSttEngine] = useState<SttEngineType>('mlx-whisper')
  const [whisperVariant, setWhisperVariant] = useState<WhisperVariantType>('kotoba-v2.0')

  const [subtitleFontSize, setSubtitleFontSize] = useState(30)
  const [subtitleSourceColor, setSubtitleSourceColor] = useState('#ffffff')
  const [subtitleTranslatedColor, setSubtitleTranslatedColor] = useState('#7dd3fc')
  const [subtitleBgOpacity, setSubtitleBgOpacity] = useState(78)
  const [subtitlePosition, setSubtitlePosition] = useState<SubtitlePositionType>('bottom')

  const [sessions, setSessions] = useState<Array<{ id: string; startedAt: number; engineMode: string; entryCount: number }>>([])

  const [slmKvCacheQuant, setSlmKvCacheQuant] = useState(true)
  const [simulMtEnabled, setSimulMtEnabled] = useState(false)
  const [simulMtWaitK, setSimulMtWaitK] = useState(3)

  const [glossaryTerms, setGlossaryTerms] = useState<Array<{ source: string; target: string }>>([])

  const [platform, setPlatform] = useState<string>('darwin')

  const [lastTranscriptPath, setLastTranscriptPath] = useState<string | null>(null)
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [isSummarizing, setIsSummarizing] = useState(false)

  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showApiOptions, setShowApiOptions] = useState(false)

  const [crashedSession, setCrashedSession] = useState<{ config: Record<string, unknown>; startedAt: number } | null>(null)

  // Noise suppression + audio capture
  const noiseSuppression = useNoiseSuppression()
  const audio = useAudioCapture(noiseSuppression.enabled ? noiseSuppression : undefined)

  // --- Timer helpers ---
  const formatDuration = useCallback((ms: number): string => {
    const totalSec = Math.floor(ms / 1000)
    const h = Math.floor(totalSec / 3600)
    const m = Math.floor((totalSec % 3600) / 60)
    const s = totalSec % 60
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    return `${m}:${String(s).padStart(2, '0')}`
  }, [])

  const startSessionTimer = useCallback(() => {
    sessionStartRef.current = Date.now()
    sessionTimerRef.current = setInterval(() => {
      if (sessionStartRef.current) {
        setSessionDuration(formatDuration(Date.now() - sessionStartRef.current))
      }
    }, 1000)
  }, [formatDuration])

  const stopSessionTimer = useCallback(() => {
    if (sessionTimerRef.current) {
      clearInterval(sessionTimerRef.current)
      sessionTimerRef.current = null
    }
    sessionStartRef.current = null
    setSessionDuration('')
  }, [])

  // --- Effects: Load settings on mount ---
  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (s.translationEngine) setEngineMode(s.translationEngine as EngineMode)
      if (s.googleApiKey) setApiKey(s.googleApiKey as string)
      if (s.deeplApiKey) setDeeplApiKey(s.deeplApiKey as string)
      if (s.geminiApiKey) setGeminiApiKey(s.geminiApiKey as string)
      if (s.microsoftApiKey) setMicrosoftApiKey(s.microsoftApiKey as string)
      if (s.microsoftRegion) setMicrosoftRegion(s.microsoftRegion as string)
      if (s.selectedMicrophone) audio.setSelectedDevice(s.selectedMicrophone as string)
      if (s.sttEngine) setSttEngine(s.sttEngine as SttEngineType)
      if (s.whisperVariant) setWhisperVariant(s.whisperVariant as WhisperVariantType)
      if (s.slmKvCacheQuant !== undefined) setSlmKvCacheQuant(s.slmKvCacheQuant as boolean)
      if (s.glossaryTerms) setGlossaryTerms(s.glossaryTerms as Array<{ source: string; target: string }>)
      if (s.simulMtEnabled !== undefined) setSimulMtEnabled(s.simulMtEnabled as boolean)
      if (s.simulMtWaitK !== undefined) setSimulMtWaitK(s.simulMtWaitK as number)
      if (s.sourceLanguage) setSourceLanguage(s.sourceLanguage as SourceLanguage)
      if (s.targetLanguage) setTargetLanguage(s.targetLanguage as Language)
      if (s.noiseSuppressionEnabled !== undefined) noiseSuppression.setEnabled(s.noiseSuppressionEnabled as boolean)
      if (s.subtitleSettings) {
        const sub = s.subtitleSettings as Record<string, unknown>
        if (sub.fontSize) setSubtitleFontSize(sub.fontSize as number)
        if (sub.sourceTextColor) setSubtitleSourceColor(sub.sourceTextColor as string)
        if (sub.translatedTextColor) setSubtitleTranslatedColor(sub.translatedTextColor as string)
        if (sub.backgroundOpacity !== undefined) setSubtitleBgOpacity(sub.backgroundOpacity as number)
        if (sub.position) setSubtitlePosition(sub.position as SubtitlePositionType)
      }

      // Auto-expand API section if an API engine is saved
      if (s.translationEngine && API_ENGINE_MODES.includes(s.translationEngine as EngineMode)) {
        setShowAdvanced(true)
        setShowApiOptions(true)
      }
    })

    // Set platform-aware STT default (mlx-whisper on macOS)
    window.api.getPlatform().then((p) => {
      setPlatform(p)
      window.api.getSettings().then((s) => {
        if (!s.sttEngine && p === 'darwin') {
          setSttEngine('mlx-whisper')
        }
      })
    }).catch((e) => console.warn('[settings] Failed to load platform/settings:', e))

    // Check for crashed session
    window.api.getCrashedSession().then((session) => {
      if (session) {
        setCrashedSession(session)
        setStatus('Previous session ended unexpectedly. Resume?')
      }
    })
  }, [])

  // Load session history
  useEffect(() => {
    window.api.listSessions().then(setSessions).catch((e) => console.warn('[settings] Failed to load sessions:', e))
  }, [isRunning])

  // Detect GPU — fall back to OPUS-MT if no GPU
  useEffect(() => {
    window.api.detectGpu().then((info) => {
      setGpuInfo(info)
      if (!info.hasGpu) {
        window.api.getSettings().then((s) => {
          if (!s.translationEngine) {
            setEngineMode('offline-opus')
          }
        })
      }
    }).catch(() => setGpuInfo({ hasGpu: false, gpuNames: [] }))
  }, [])

  // Load displays and listen for display changes
  useEffect(() => {
    const refreshDisplays = (): void => {
      window.api.getDisplays().then((d) => {
        setDisplays(d)
        const external = d.find((disp: DisplayInfo) => disp.label.includes('External'))
        setSelectedDisplay(external?.id ?? d[0]?.id ?? 0)
      })
    }
    refreshDisplays()
    const unsubscribe = window.api.onDisplaysChanged(refreshDisplays)
    return () => unsubscribe?.()
  }, [])

  // Handle audio: streaming chunks during speech, final segment on speech end
  useEffect(() => {
    const unsub1 = audio.onAudioChunk((chunk) => {
      window.api.processAudio(Array.from(chunk))
    })
    const unsub2 = audio.onStreamingChunk((buffer) => {
      window.api.processAudioStreaming(Array.from(buffer))
    })
    const unsub3 = audio.onSpeechSegmentEnd((finalBuffer) => {
      window.api.finalizeStreaming(Array.from(finalBuffer))
    })

    return () => {
      unsub1()
      unsub2()
      unsub3()
    }

  }, [])

  // Listen for status updates from main process
  useEffect(() => {
    const unsubscribe = window.api.onStatusUpdate((message) => {
      setStatus(message)
    })
    return () => unsubscribe?.()
  }, [])

  // Cleanup session timer on unmount
  useEffect(() => {
    return () => {
      if (sessionTimerRef.current) {
        clearInterval(sessionTimerRef.current)
      }
    }
  }, [])

  // --- Actions ---
  const apiKeys = { apiKey, deeplApiKey, geminiApiKey, microsoftApiKey, microsoftRegion }

  const handleStart = async (): Promise<void> => {
    if (isStarting) return
    setIsStarting(true)

    try {
      setStatus('Starting pipeline...')

      await withIpcTimeout(window.api.saveSettings({
        translationEngine: engineMode,
        googleApiKey: apiKey,
        deeplApiKey,
        geminiApiKey,
        microsoftApiKey,
        microsoftRegion,
        selectedMicrophone: audio.selectedDevice,
        selectedDisplay,
        sttEngine,
        whisperVariant,
        slmKvCacheQuant,
        simulMtEnabled,
        simulMtWaitK,
        sourceLanguage,
        targetLanguage,
        noiseSuppressionEnabled: noiseSuppression.enabled
      }), 10_000, 'saveSettings')

      const resolvedMode = resolveEngineMode(engineMode, apiKeys, gpuInfo)
      const config = buildEngineConfig(resolvedMode, sttEngine, apiKeys)

      const result = await withIpcTimeout(window.api.pipelineStart(config), 120_000, 'pipelineStart')
      if (result.error) {
        setStatus(`Error: ${result.error}`)
        setIsStarting(false)
        return
      }

      await audio.start()
      setIsRunning(true)
      startSessionTimer()
      setStatus('Listening...')
    } catch (err) {
      setStatus(`Error: ${err}`)
      setIsRunning(false)
      stopSessionTimer()
    } finally {
      setIsStarting(false)
    }
  }

  const handleStop = async (): Promise<void> => {
    try {
      audio.stop()
      stopSessionTimer()
      const result = await withIpcTimeout(window.api.pipelineStop(), 10_000, 'pipelineStop')
      setStatus(result.logPath ? `Saved: ${result.logPath}` : 'Stopped')

      if (result.logPath) {
        setLastTranscriptPath(result.logPath)
      }
    } catch (err) {
      setStatus(`Stop error: ${err}`)
    } finally {
      setIsRunning(false)
    }
  }

  const handleResume = async (): Promise<void> => {
    if (!crashedSession || isStarting) return
    setIsStarting(true)

    try {
      setStatus('Resuming previous session...')
      const result = await withIpcTimeout(window.api.pipelineStart(crashedSession.config), 120_000, 'pipelineStart')
      if (result.error) {
        setStatus(`Resume failed: ${result.error}`)
        setIsStarting(false)
        return
      }
      await audio.start()
      setIsRunning(true)
      setCrashedSession(null)
      startSessionTimer()
      setStatus('Listening... (resumed)')
    } catch (err) {
      setStatus(`Resume failed: ${err}`)
      setIsRunning(false)
      audio.stop()
      stopSessionTimer()
    } finally {
      setIsStarting(false)
    }
  }

  const handleDismissResume = (): void => {
    setCrashedSession(null)
    setStatus('Ready')
  }

  const pushSubtitleSettings = (overrides: Record<string, unknown> = {}): void => {
    const settings = {
      fontSize: subtitleFontSize,
      sourceTextColor: subtitleSourceColor,
      translatedTextColor: subtitleTranslatedColor,
      backgroundOpacity: subtitleBgOpacity,
      position: subtitlePosition,
      ...overrides
    }
    window.api.saveSubtitleSettings(settings)
  }

  const handleDisplayChange = (displayId: number): void => {
    setSelectedDisplay(displayId)
    window.api.moveSubtitleToDisplay(displayId)
  }

  const handleGenerateSummary = async (): Promise<void> => {
    if (!lastTranscriptPath) return
    setIsSummarizing(true)
    setStatus('Generating meeting summary...')
    const result = await withIpcTimeout(window.api.generateSummary(lastTranscriptPath), 120_000, 'generateSummary')
    setIsSummarizing(false)
    if (result.summary) {
      setSummaryText(result.summary)
      setStatus('Summary generated')
    } else {
      setStatus(`Summary failed: ${result.error}`)
    }
  }

  return {
    engineMode, setEngineMode,
    gpuInfo,
    apiKey, setApiKey,
    deeplApiKey, setDeeplApiKey,
    geminiApiKey, setGeminiApiKey,
    microsoftApiKey, setMicrosoftApiKey,
    microsoftRegion, setMicrosoftRegion,
    displays, selectedDisplay, handleDisplayChange,
    status, setStatus,
    isRunning, isStarting,
    sessionDuration,
    sessions,
    sourceLanguage, setSourceLanguage,
    targetLanguage, setTargetLanguage,
    sttEngine, setSttEngine,
    whisperVariant, setWhisperVariant,
    subtitleFontSize, setSubtitleFontSize,
    subtitleSourceColor, setSubtitleSourceColor,
    subtitleTranslatedColor, setSubtitleTranslatedColor,
    subtitleBgOpacity, setSubtitleBgOpacity,
    subtitlePosition, setSubtitlePosition,
    slmKvCacheQuant, setSlmKvCacheQuant,
    simulMtEnabled, setSimulMtEnabled,
    simulMtWaitK, setSimulMtWaitK,
    glossaryTerms, setGlossaryTerms,
    platform,
    lastTranscriptPath,
    summaryText,
    isSummarizing,
    crashedSession,
    showAdvanced, setShowAdvanced,
    showApiOptions, setShowApiOptions,
    audio, noiseSuppression,
    handleStart, handleStop, handleResume, handleDismissResume,
    pushSubtitleSettings,
    handleGenerateSummary
  }
}
