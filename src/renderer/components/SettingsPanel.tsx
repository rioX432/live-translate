import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioCapture } from '../hooks/useAudioCapture'
import { useNoiseSuppression } from '../hooks/useNoiseSuppression'
import {
  AudioSettings,
  LanguageSettings,
  STTSettings,
  TranslatorSettings,
  SubtitleSettings,
  SessionControls,
  UpdateStatus
} from './settings'
import {
  LANGUAGE_LABELS,
  withIpcTimeout
} from './settings/shared'
import type {
  DisplayInfo,
  EngineMode,
  Language,
  MoonshineVariantType,
  SlmModelSizeType,
  SourceLanguage,
  SttEngineType,
  SubtitlePositionType,
  WhisperVariantType
} from './settings/shared'

function SettingsPanel(): React.JSX.Element {
  const [engineMode, setEngineMode] = useState<EngineMode>('offline-hybrid')
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

  const [sttEngine, setSttEngine] = useState<SttEngineType>('whisper-local')
  const [whisperVariant, setWhisperVariant] = useState<WhisperVariantType>('kotoba-v2.0')
  const [moonshineVariant, setMoonshineVariant] = useState<MoonshineVariantType>('base')

  const [subtitleFontSize, setSubtitleFontSize] = useState(30)
  const [subtitleSourceColor, setSubtitleSourceColor] = useState('#ffffff')
  const [subtitleTranslatedColor, setSubtitleTranslatedColor] = useState('#7dd3fc')
  const [subtitleBgOpacity, setSubtitleBgOpacity] = useState(78)
  const [subtitlePosition, setSubtitlePosition] = useState<SubtitlePositionType>('bottom')

  const [sessions, setSessions] = useState<Array<{ id: string; startedAt: number; engineMode: string; entryCount: number }>>([])

  const [slmKvCacheQuant, setSlmKvCacheQuant] = useState(true)
  const [slmModelSize, setSlmModelSize] = useState<SlmModelSizeType>('4b')
  const [slmSpeculativeDecoding, setSlmSpeculativeDecoding] = useState(false)
  const [draftModelAvailable, setDraftModelAvailable] = useState(false)
  const [simulMtEnabled, setSimulMtEnabled] = useState(false)
  const [simulMtWaitK, setSimulMtWaitK] = useState(3)

  const [glossaryTerms, setGlossaryTerms] = useState<Array<{ source: string; target: string }>>([])

  const [platform, setPlatform] = useState<string>('darwin')

  const [lastTranscriptPath, setLastTranscriptPath] = useState<string | null>(null)
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [isSummarizing, setIsSummarizing] = useState(false)

  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showApiOptions, setShowApiOptions] = useState(false)

  // #313: Noise suppression
  const noiseSuppression = useNoiseSuppression()
  const audio = useAudioCapture(noiseSuppression.enabled ? noiseSuppression : undefined)

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

  const [crashedSession, setCrashedSession] = useState<{ config: Record<string, unknown>; startedAt: number } | null>(null)

  // Load saved settings on mount and set platform-aware defaults
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
      if (s.moonshineVariant) setMoonshineVariant(s.moonshineVariant as MoonshineVariantType)
      if (s.slmKvCacheQuant !== undefined) setSlmKvCacheQuant(s.slmKvCacheQuant as boolean)
      if (s.slmModelSize) setSlmModelSize(s.slmModelSize as SlmModelSizeType)
      if (s.slmSpeculativeDecoding !== undefined) setSlmSpeculativeDecoding(s.slmSpeculativeDecoding as boolean)
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
      const apiModes: EngineMode[] = ['rotation', 'online', 'online-deepl', 'online-gemini']
      if (s.translationEngine && apiModes.includes(s.translationEngine as EngineMode)) {
        setShowAdvanced(true)
        setShowApiOptions(true)
      }
    })

    // Set platform-aware STT default (mlx-whisper on macOS)
    window.api.getPlatform().then((p) => {
      setPlatform(p)
      // Only set default if no saved setting exists
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
      // If no GPU and no saved engine preference, fall back to OPUS-MT
      if (!info.hasGpu) {
        window.api.getSettings().then((s) => {
          if (!s.translationEngine) {
            setEngineMode('offline-opus')
          }
        })
      }
    }).catch(() => setGpuInfo({ hasGpu: false, gpuNames: [] }))
  }, [])

  // Check if draft model is available for speculative decoding
  // For TranslateGemma 12B: checks 4B draft; for ALMA-7B: checks Gemma-2-2B draft
  useEffect(() => {
    const engine = engineMode === 'offline-alma-ja' ? 'alma-ja' : undefined
    window.api.isDraftModelAvailable(engine).then(setDraftModelAvailable).catch(() => setDraftModelAvailable(false))
  }, [slmModelSize, engineMode])

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
        moonshineVariant,
        slmKvCacheQuant,
        slmModelSize,
        slmSpeculativeDecoding,
        simulMtEnabled,
        simulMtWaitK,
        sourceLanguage,
        targetLanguage,
        noiseSuppressionEnabled: noiseSuppression.enabled
      }), 10_000, 'saveSettings')

      // Resolve auto mode to concrete engine
      let resolvedMode = engineMode
      if (engineMode === 'auto') {
        const hasKeys = !!(apiKey || deeplApiKey || geminiApiKey || (microsoftApiKey && microsoftRegion))
        if (hasKeys) {
          resolvedMode = 'rotation'
        } else if (gpuInfo?.hasGpu) {
          resolvedMode = 'offline-hunyuan-mt-15'
        } else {
          resolvedMode = 'offline-opus'
        }
      }

      // Build engine config
      let config: Record<string, unknown>
      if (resolvedMode === 'rotation') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'rotation-controller',
          ...(apiKey && { apiKey }),
          ...(deeplApiKey && { deeplApiKey }),
          ...(geminiApiKey && { geminiApiKey }),
          ...(microsoftApiKey && microsoftRegion && { microsoftApiKey, microsoftRegion })
        }
      } else if (resolvedMode === 'online') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'google-translate',
          apiKey
        }
      } else if (resolvedMode === 'online-deepl') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'deepl-translate',
          deeplApiKey
        }
      } else if (resolvedMode === 'online-gemini') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'gemini-translate',
          geminiApiKey
        }
      } else if (resolvedMode === 'offline-opus') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'opus-mt'
        }
      } else if (resolvedMode === 'offline-ct2-opus') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'ct2-opus-mt'
        }
      } else if (resolvedMode === 'offline-madlad-400') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'ct2-madlad-400'
        }
      } else if (resolvedMode === 'offline-slm') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'slm-translate'
        }
      } else if (resolvedMode === 'offline-hunyuan-mt') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'hunyuan-mt'
        }
      } else if (resolvedMode === 'offline-hunyuan-mt-15') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'hunyuan-mt-15'
        }
      } else if (resolvedMode === 'offline-gemma2-jpn') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'gemma2-jpn'
        }
      } else if (resolvedMode === 'offline-alma-ja') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'alma-ja'
        }
      } else if (resolvedMode === 'offline-ane') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'ane-translate'
        }
      } else if (resolvedMode === 'offline-hybrid') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'hybrid'
        }
      } else {
        config = {
          mode: 'cascade' as const,
          sttEngineId: sttEngine,
          translatorEngineId: 'opus-mt'
        }
      }

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

  // Resume crashed session
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

  // Current engine display name
  const engineDisplayName = (): string => {
    switch (engineMode) {
      case 'offline-hybrid': return 'Hybrid (OPUS-MT + TranslateGemma)'
      case 'offline-slm': return 'TranslateGemma'
      case 'offline-hunyuan-mt-15': return 'HY-MT1.5-1.8B'
      case 'offline-gemma2-jpn': return 'Gemma-2-2B JA↔EN'
      case 'offline-alma-ja': return 'ALMA-7B-Ja-V2'
      case 'offline-hunyuan-mt': return 'Hunyuan-MT 7B'
      case 'offline-opus': return 'OPUS-MT'
      case 'offline-ct2-opus': return 'OPUS-MT (CTranslate2)'
      case 'offline-madlad-400': return 'Madlad-400 (450+ Languages)'
      case 'offline-ane': return 'ANEMLL (Apple Neural Engine)'
      case 'rotation': return 'API Auto Rotation'
      case 'online': return 'Google Translation'
      case 'online-deepl': return 'DeepL'
      case 'online-gemini': return 'Gemini 2.5 Flash'
      case 'auto': return 'Auto'
      default: return engineMode
    }
  }

  const sttDisplayName = (): string => {
    switch (sttEngine) {
      case 'mlx-whisper': return 'mlx-whisper (Apple Silicon)'
      case 'whisper-local':
        return whisperVariant === 'large-v3-turbo'
          ? 'Whisper (large-v3-turbo)'
          : 'Whisper (kotoba-v2.0)'
      case 'moonshine': return 'Moonshine AI'
      case 'sensevoice': return 'SenseVoice (CJK-optimized)'
      case 'sherpa-onnx': return 'Sherpa-ONNX (unified)'
      default: return sttEngine
    }
  }

  // Language display name for config summary
  const languageDisplayName = (): string => {
    const src = sourceLanguage === 'auto' ? 'Auto-detect' : LANGUAGE_LABELS[sourceLanguage]
    const tgt = LANGUAGE_LABELS[targetLanguage]
    return `${src} \u2192 ${tgt}`
  }

  const disabled = isRunning || isStarting

  return (
    <div style={containerStyle}>
      <h1 style={titleStyle}>live-translate</h1>

      {/* Crash recovery banner */}
      {crashedSession && !isRunning && (
        <div role="alert" aria-live="assertive" aria-atomic="true" style={{
          background: '#1e293b',
          border: '1px solid #f59e0b',
          borderRadius: '8px',
          padding: '12px 16px',
          marginBottom: '16px',
          fontSize: '13px'
        }}>
          <div style={{ color: '#f59e0b', fontWeight: 600, marginBottom: '6px' }}>
            Previous session ended unexpectedly
          </div>
          <div style={{ color: '#94a3b8', marginBottom: '8px' }}>
            Resume with the same engine configuration?
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleResume}
              disabled={isStarting}
              style={{
                padding: '6px 16px',
                fontSize: '13px',
                fontWeight: 600,
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                color: '#fff',
                background: '#16a34a'
              }}
            >
              Resume
            </button>
            <button
              onClick={handleDismissResume}
              style={{
                padding: '6px 16px',
                fontSize: '13px',
                fontWeight: 600,
                border: '1px solid #334155',
                borderRadius: '6px',
                cursor: 'pointer',
                color: '#94a3b8',
                background: 'transparent'
              }}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {/* Microphone Selection — always visible */}
      <AudioSettings
        audio={audio}
        disabled={disabled}
        noiseSuppressionEnabled={noiseSuppression.enabled}
        onNoiseSuppressionChange={noiseSuppression.setEnabled}
      />

      {/* Current config summary — always visible */}
      <div style={{
        background: '#1e293b',
        borderRadius: '8px',
        padding: '10px 14px',
        marginBottom: '16px',
        fontSize: '12px',
        color: '#94a3b8'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <span>Speech Recognition</span>
          <span style={{ color: '#e2e8f0' }}>{sttDisplayName()}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span>Translation</span>
          <span style={{ color: '#e2e8f0' }}>{engineDisplayName()}</span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
          <span>Language</span>
          <span style={{ color: '#e2e8f0' }}>{languageDisplayName()}</span>
        </div>
        {gpuInfo && (
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
            <span>GPU</span>
            <span style={{ color: gpuInfo.hasGpu ? '#22c55e' : '#f59e0b' }}>
              {gpuInfo.hasGpu ? gpuInfo.gpuNames.join(', ') : 'Not detected'}
            </span>
          </div>
        )}
      </div>

      {/* Advanced Settings toggle */}
      <button
        onClick={() => setShowAdvanced(!showAdvanced)}
        style={{
          width: '100%',
          padding: '10px 14px',
          background: 'transparent',
          border: '1px solid #334155',
          borderRadius: '8px',
          color: '#94a3b8',
          fontSize: '13px',
          fontWeight: 500,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '16px'
        }}
      >
        <span>Advanced Settings</span>
        <span style={{ transform: showAdvanced ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
          ▼
        </span>
      </button>

      {/* Advanced Settings content */}
      {showAdvanced && (
        <div style={{ marginBottom: '16px' }}>
          <LanguageSettings
            sourceLanguage={sourceLanguage}
            onSourceLanguageChange={setSourceLanguage}
            targetLanguage={targetLanguage}
            onTargetLanguageChange={setTargetLanguage}
            disabled={disabled}
          />

          <STTSettings
            sttEngine={sttEngine}
            onSttEngineChange={setSttEngine}
            whisperVariant={whisperVariant}
            onWhisperVariantChange={setWhisperVariant}
            moonshineVariant={moonshineVariant}
            onMoonshineVariantChange={setMoonshineVariant}
            platform={platform}
            disabled={disabled}
          />

          <TranslatorSettings
            engineMode={engineMode}
            onEngineModeChange={setEngineMode}
            platform={platform}
            disabled={disabled}
            gpuInfo={gpuInfo}
            slmModelSize={slmModelSize}
            onSlmModelSizeChange={setSlmModelSize}
            slmKvCacheQuant={slmKvCacheQuant}
            onSlmKvCacheQuantChange={setSlmKvCacheQuant}
            slmSpeculativeDecoding={slmSpeculativeDecoding}
            onSlmSpeculativeDecodingChange={setSlmSpeculativeDecoding}
            draftModelAvailable={draftModelAvailable}
            simulMtEnabled={simulMtEnabled}
            onSimulMtEnabledChange={setSimulMtEnabled}
            simulMtWaitK={simulMtWaitK}
            onSimulMtWaitKChange={setSimulMtWaitK}
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
            deeplApiKey={deeplApiKey}
            onDeeplApiKeyChange={setDeeplApiKey}
            geminiApiKey={geminiApiKey}
            onGeminiApiKeyChange={setGeminiApiKey}
            microsoftApiKey={microsoftApiKey}
            onMicrosoftApiKeyChange={setMicrosoftApiKey}
            microsoftRegion={microsoftRegion}
            onMicrosoftRegionChange={setMicrosoftRegion}
            showApiOptions={showApiOptions}
            onShowApiOptionsChange={setShowApiOptions}
            glossaryTerms={glossaryTerms}
            onGlossaryTermsChange={setGlossaryTerms}
          />

          <SubtitleSettings
            fontSize={subtitleFontSize}
            onFontSizeChange={(v) => { setSubtitleFontSize(v); pushSubtitleSettings({ fontSize: v }) }}
            sourceColor={subtitleSourceColor}
            onSourceColorChange={(v) => { setSubtitleSourceColor(v); pushSubtitleSettings({ sourceTextColor: v }) }}
            translatedColor={subtitleTranslatedColor}
            onTranslatedColorChange={(v) => { setSubtitleTranslatedColor(v); pushSubtitleSettings({ translatedTextColor: v }) }}
            bgOpacity={subtitleBgOpacity}
            onBgOpacityChange={(v) => { setSubtitleBgOpacity(v); pushSubtitleSettings({ backgroundOpacity: v }) }}
            position={subtitlePosition}
            onPositionChange={(v) => { setSubtitlePosition(v); pushSubtitleSettings({ position: v }) }}
            displays={displays}
            selectedDisplay={selectedDisplay}
            onDisplayChange={handleDisplayChange}
          />

          <UpdateStatus />
        </div>
      )}

      {/* Session controls — always visible */}
      <SessionControls
        isRunning={isRunning}
        isStarting={isStarting}
        engineMode={engineMode}
        apiKey={apiKey}
        deeplApiKey={deeplApiKey}
        geminiApiKey={geminiApiKey}
        microsoftApiKey={microsoftApiKey}
        status={status}
        sessionDuration={sessionDuration}
        onStart={handleStart}
        onStop={handleStop}
        lastTranscriptPath={lastTranscriptPath}
        summaryText={summaryText}
        isSummarizing={isSummarizing}
        onGenerateSummary={handleGenerateSummary}
        onSetStatus={setStatus}
        sessions={sessions}
      />
    </div>
  )
}

const containerStyle: React.CSSProperties = {
  padding: '20px 24px',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color: '#e2e8f0',
  background: '#0f172a',
  minHeight: '100vh',
  fontSize: '14px'
}

const titleStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 700,
  marginBottom: '20px',
  color: '#f8fafc',
  letterSpacing: '-0.02em'
}

export default SettingsPanel
