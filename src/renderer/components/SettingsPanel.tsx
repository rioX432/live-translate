import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioCapture } from '../hooks/useAudioCapture'

/** Wrap a promise with a timeout to prevent UI freezes when main process hangs */
function withIpcTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer))
}

type EngineMode = 'auto' | 'rotation' | 'online' | 'online-deepl' | 'online-gemini' | 'offline-opus' | 'offline-ct2-opus' | 'offline-slm' | 'offline-hunyuan-mt' | 'offline-hybrid'

interface DisplayInfo {
  id: number
  label: string
}

function SettingsPanel(): JSX.Element {
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

  const [sttEngine, setSttEngine] = useState<'whisper-local' | 'mlx-whisper' | 'moonshine'>('whisper-local')

  const [subtitleFontSize, setSubtitleFontSize] = useState(30)
  const [subtitleSourceColor, setSubtitleSourceColor] = useState('#ffffff')
  const [subtitleTranslatedColor, setSubtitleTranslatedColor] = useState('#7dd3fc')
  const [subtitleBgOpacity, setSubtitleBgOpacity] = useState(78)
  const [subtitlePosition, setSubtitlePosition] = useState<'top' | 'bottom'>('bottom')

  const [sessions, setSessions] = useState<Array<{ id: string; startedAt: number; engineMode: string; entryCount: number }>>([])

  const [slmKvCacheQuant, setSlmKvCacheQuant] = useState(true)
  const [slmModelSize, setSlmModelSize] = useState<'4b' | '12b'>('4b')
  const [slmSpeculativeDecoding, setSlmSpeculativeDecoding] = useState(false)
  const [draftModelAvailable, setDraftModelAvailable] = useState(false)
  const [simulMtEnabled, setSimulMtEnabled] = useState(false)
  const [simulMtWaitK, setSimulMtWaitK] = useState(3)

  const [glossaryTerms, setGlossaryTerms] = useState<Array<{ source: string; target: string }>>([])
  const [newGlossarySource, setNewGlossarySource] = useState('')
  const [newGlossaryTarget, setNewGlossaryTarget] = useState('')

  const [platform, setPlatform] = useState<string>('darwin')

  const [lastTranscriptPath, setLastTranscriptPath] = useState<string | null>(null)
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [isSummarizing, setIsSummarizing] = useState(false)

  // UI state
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [showApiOptions, setShowApiOptions] = useState(false)

  const audio = useAudioCapture()

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
      if (s.sttEngine) setSttEngine(s.sttEngine as 'whisper-local' | 'mlx-whisper' | 'moonshine')
      if (s.slmKvCacheQuant !== undefined) setSlmKvCacheQuant(s.slmKvCacheQuant as boolean)
      if (s.slmModelSize) setSlmModelSize(s.slmModelSize as '4b' | '12b')
      if (s.slmSpeculativeDecoding !== undefined) setSlmSpeculativeDecoding(s.slmSpeculativeDecoding as boolean)
      if (s.glossaryTerms) setGlossaryTerms(s.glossaryTerms as Array<{ source: string; target: string }>)
      if (s.simulMtEnabled !== undefined) setSimulMtEnabled(s.simulMtEnabled as boolean)
      if (s.simulMtWaitK !== undefined) setSimulMtWaitK(s.simulMtWaitK as number)
      if (s.subtitleSettings) {
        const sub = s.subtitleSettings as Record<string, unknown>
        if (sub.fontSize) setSubtitleFontSize(sub.fontSize as number)
        if (sub.sourceTextColor) setSubtitleSourceColor(sub.sourceTextColor as string)
        if (sub.translatedTextColor) setSubtitleTranslatedColor(sub.translatedTextColor as string)
        if (sub.backgroundOpacity !== undefined) setSubtitleBgOpacity(sub.backgroundOpacity as number)
        if (sub.position) setSubtitlePosition(sub.position as 'top' | 'bottom')
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
    }).catch(() => {})

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
    window.api.listSessions().then(setSessions).catch(() => {})
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

  // Check if 4B draft model is available for speculative decoding
  useEffect(() => {
    window.api.isDraftModelAvailable().then(setDraftModelAvailable).catch(() => setDraftModelAvailable(false))
  }, [slmModelSize])

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
  // eslint-disable-next-line react-hooks/exhaustive-deps -- callbacks use stable refs internally
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
        slmKvCacheQuant,
        slmModelSize,
        slmSpeculativeDecoding,
        simulMtEnabled,
        simulMtWaitK
      }), 10_000, 'saveSettings')

      // Resolve auto mode to concrete engine
      let resolvedMode = engineMode
      if (engineMode === 'auto') {
        const hasKeys = !!(apiKey || deeplApiKey || geminiApiKey || (microsoftApiKey && microsoftRegion))
        if (hasKeys) {
          resolvedMode = 'rotation'
        } else if (gpuInfo?.hasGpu) {
          resolvedMode = 'offline-slm'
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

  // Helper: is current engine an API engine?
  const isApiEngine = ['rotation', 'online', 'online-deepl', 'online-gemini'].includes(engineMode)

  // Current engine display name
  const engineDisplayName = (): string => {
    switch (engineMode) {
      case 'offline-hybrid': return 'Hybrid (OPUS-MT + TranslateGemma)'
      case 'offline-slm': return 'TranslateGemma'
      case 'offline-hunyuan-mt': return 'Hunyuan-MT 7B'
      case 'offline-opus': return 'OPUS-MT'
      case 'offline-ct2-opus': return 'OPUS-MT (CTranslate2)'
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
      case 'whisper-local': return 'Whisper (whisper.cpp)'
      case 'moonshine': return 'Moonshine AI'
      default: return sttEngine
    }
  }

  // Does the current engine use SLM options?
  const showSlmOptions = ['offline-slm', 'offline-hunyuan-mt', 'offline-hybrid'].includes(engineMode)

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
      <Section label="Microphone">
        <select
          value={audio.selectedDevice}
          onChange={(e) => audio.setSelectedDevice(e.target.value)}
          style={selectStyle}
          disabled={isRunning || isStarting}
          aria-label="Microphone device"
        >
          {audio.devices.map((d) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label}
            </option>
          ))}
        </select>
        {/* Volume meter */}
        <div style={{ marginTop: '6px', height: '4px', background: '#1e293b', borderRadius: '2px' }}>
          <div
            style={{
              height: '100%',
              width: `${audio.volume * 100}%`,
              background: audio.volume > 0.7 ? '#ef4444' : '#22c55e',
              borderRadius: '2px',
              transition: 'width 0.1s'
            }}
          />
        </div>
        {audio.permissionError && (
          <div style={{ marginTop: '6px', fontSize: '12px', color: '#ef4444' }}>
            {audio.permissionError}
          </div>
        )}
      </Section>

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
          {/* STT Engine */}
          <Section label="Speech Recognition">
            <select
              value={sttEngine}
              onChange={(e) => setSttEngine(e.target.value as 'whisper-local' | 'mlx-whisper' | 'moonshine')}
              style={selectStyle}
              disabled={isRunning || isStarting}
              aria-label="STT engine"
            >
              <option value="whisper-local">Whisper (whisper.cpp)</option>
              {platform === 'darwin' && (
                <option value="mlx-whisper">mlx-whisper (Apple Silicon, faster)</option>
              )}
              <option value="moonshine">Moonshine AI (ultra-fast, experimental)</option>
            </select>
            {sttEngine === 'moonshine' && (
              <div style={{ marginTop: '4px', fontSize: '11px', color: '#f59e0b' }}>
                Japanese accuracy is unverified. If results are poor, switch to Whisper.
              </div>
            )}
          </Section>

          {/* Offline Translation Engines */}
          <Section label="Translation Engine" role="radiogroup">
            <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
              Offline
            </div>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="engine"
                checked={engineMode === 'offline-hybrid'}
                onChange={() => setEngineMode('offline-hybrid')}
                disabled={isRunning || isStarting}
              />
              <div>
                <div style={{ fontWeight: 500 }}>Hybrid (OPUS-MT + TranslateGemma)</div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>Instant draft + LLM refinement — best offline quality</div>
              </div>
            </label>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="engine"
                checked={engineMode === 'offline-slm'}
                onChange={() => setEngineMode('offline-slm')}
                disabled={isRunning || isStarting}
              />
              <div>
                <div style={{ fontWeight: 500 }}>TranslateGemma</div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>GPU-accelerated offline translation</div>
              </div>
            </label>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="engine"
                checked={engineMode === 'offline-hunyuan-mt'}
                onChange={() => setEngineMode('offline-hunyuan-mt')}
                disabled={isRunning || isStarting}
              />
              <div>
                <div style={{ fontWeight: 500 }}>Hunyuan-MT 7B (WMT25 Winner)</div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>33 languages, ~4.7GB download</div>
              </div>
            </label>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="engine"
                checked={engineMode === 'offline-opus'}
                onChange={() => setEngineMode('offline-opus')}
                disabled={isRunning || isStarting}
              />
              <div>
                <div style={{ fontWeight: 500 }}>OPUS-MT</div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>Lightweight, ~100MB — fast but basic</div>
              </div>
            </label>
            <label style={radioLabelStyle}>
              <input
                type="radio"
                name="engine"
                checked={engineMode === 'offline-ct2-opus'}
                onChange={() => setEngineMode('offline-ct2-opus')}
                disabled={isRunning || isStarting}
              />
              <div>
                <div style={{ fontWeight: 500 }}>OPUS-MT (CTranslate2)</div>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>6-10x faster, requires Python 3</div>
              </div>
            </label>

            {/* SLM sub-options */}
            {showSlmOptions && (
              <>
                {gpuInfo && !gpuInfo.hasGpu && (
                  <div style={{ fontSize: '11px', color: '#f59e0b', padding: '4px 0 4px 24px' }}>
                    No GPU detected — translation may be slow on CPU-only systems
                  </div>
                )}
                <div style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '2px', marginTop: '4px' }}>
                  <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '2px' }}>Model Size</div>
                  <label style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="slm-model-size"
                      checked={slmModelSize === '4b'}
                      onChange={() => setSlmModelSize('4b')}
                      disabled={isRunning || isStarting}
                    />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '12px' }}>4B (Faster, ~2.6GB)</div>
                    </div>
                  </label>
                  <label style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="slm-model-size"
                      checked={slmModelSize === '12b'}
                      onChange={() => setSlmModelSize('12b')}
                      disabled={isRunning || isStarting}
                    />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '12px' }}>12B (Higher quality, ~7.3GB)</div>
                    </div>
                  </label>
                </div>
                <label style={{ ...radioLabelStyle, paddingLeft: '24px' }}>
                  <input
                    type="checkbox"
                    checked={slmKvCacheQuant}
                    onChange={(e) => setSlmKvCacheQuant(e.target.checked)}
                    disabled={isRunning || isStarting}
                  />
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '12px' }}>KV cache quantization (Q8_0)</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>Reduces VRAM ~50%</div>
                  </div>
                </label>
                {slmModelSize === '12b' && (
                  <label style={{ ...radioLabelStyle, paddingLeft: '24px' }}>
                    <input
                      type="checkbox"
                      checked={slmSpeculativeDecoding}
                      onChange={(e) => setSlmSpeculativeDecoding(e.target.checked)}
                      disabled={isRunning || isStarting || !draftModelAvailable}
                    />
                    <div>
                      <div style={{ fontWeight: 500, fontSize: '12px' }}>Speculative decoding (4B draft + 12B verify)</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>2-3x throughput, requires both models in VRAM (~10GB)</div>
                      {!draftModelAvailable && (
                        <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '2px' }}>
                          Download the 4B model first
                        </div>
                      )}
                    </div>
                  </label>
                )}
                <label style={{ ...radioLabelStyle, paddingLeft: '24px' }}>
                  <input
                    type="checkbox"
                    checked={simulMtEnabled}
                    onChange={(e) => setSimulMtEnabled(e.target.checked)}
                    disabled={isRunning || isStarting}
                  />
                  <div>
                    <div style={{ fontWeight: 500, fontSize: '12px' }}>Simultaneous translation (SimulMT)</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>Start translating before speaker finishes</div>
                  </div>
                </label>
                {simulMtEnabled && (
                  <div style={{ paddingLeft: '48px', marginTop: '-4px', marginBottom: '4px' }}>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                      Wait-k: start after {simulMtWaitK} confirmed words
                    </div>
                    <input
                      type="range"
                      aria-label="Wait-k value"
                      min={1}
                      max={10}
                      value={simulMtWaitK}
                      onChange={(e) => setSimulMtWaitK(Number(e.target.value))}
                      disabled={isRunning || isStarting}
                      style={{ width: '100%' }}
                    />
                  </div>
                )}
              </>
            )}

            {/* API Translation — collapsed by default */}
            <div style={{ marginTop: '12px' }}>
              <button
                onClick={() => setShowApiOptions(!showApiOptions)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  cursor: 'pointer',
                  padding: '4px 0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <span style={{ transform: showApiOptions ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', fontSize: '10px' }}>
                  ▶
                </span>
                API Translation (requires internet)
              </button>

              {showApiOptions && (
                <div style={{ marginTop: '4px' }}>
                  <label style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="engine"
                      checked={engineMode === 'rotation'}
                      onChange={() => setEngineMode('rotation')}
                      disabled={isRunning || isStarting}
                    />
                    <div>
                      <div style={{ fontWeight: 500 }}>Auto Rotation — up to 4M+ chars/month free</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>Azure → Google → DeepL → Gemini</div>
                    </div>
                  </label>
                  <label style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="engine"
                      checked={engineMode === 'online'}
                      onChange={() => setEngineMode('online')}
                      disabled={isRunning || isStarting}
                    />
                    <div style={{ fontWeight: 500 }}>Google Translation</div>
                  </label>
                  <label style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="engine"
                      checked={engineMode === 'online-deepl'}
                      onChange={() => setEngineMode('online-deepl')}
                      disabled={isRunning || isStarting}
                    />
                    <div style={{ fontWeight: 500 }}>DeepL</div>
                  </label>
                  <label style={radioLabelStyle}>
                    <input
                      type="radio"
                      name="engine"
                      checked={engineMode === 'online-gemini'}
                      onChange={() => setEngineMode('online-gemini')}
                      disabled={isRunning || isStarting}
                    />
                    <div style={{ fontWeight: 500 }}>Gemini 2.5 Flash</div>
                  </label>

                  {/* API Keys */}
                  {isApiEngine && (
                    <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {(engineMode === 'rotation' || engineMode === 'online') && (
                        <input
                          type="password"
                          value={apiKey}
                          onChange={(e) => setApiKey(e.target.value)}
                          placeholder="Google Cloud Translation key"
                          style={inputStyle}
                          disabled={isRunning || isStarting}
                        />
                      )}
                      {(engineMode === 'rotation' || engineMode === 'online-deepl') && (
                        <input
                          type="password"
                          value={deeplApiKey}
                          onChange={(e) => setDeeplApiKey(e.target.value)}
                          placeholder="DeepL API key"
                          style={inputStyle}
                          disabled={isRunning || isStarting}
                        />
                      )}
                      {(engineMode === 'rotation' || engineMode === 'online-gemini') && (
                        <input
                          type="password"
                          value={geminiApiKey}
                          onChange={(e) => setGeminiApiKey(e.target.value)}
                          placeholder="Gemini API key"
                          style={inputStyle}
                          disabled={isRunning || isStarting}
                        />
                      )}
                      {engineMode === 'rotation' && (
                        <>
                          <input
                            type="password"
                            value={microsoftApiKey}
                            onChange={(e) => setMicrosoftApiKey(e.target.value)}
                            placeholder="Azure Microsoft Translator key"
                            style={inputStyle}
                            disabled={isRunning || isStarting}
                          />
                          <input
                            type="text"
                            value={microsoftRegion}
                            onChange={(e) => setMicrosoftRegion(e.target.value)}
                            placeholder="Azure region (e.g. eastus)"
                            style={inputStyle}
                            disabled={isRunning || isStarting}
                          />
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </Section>

          {/* Glossary */}
          <Section label="Translation Glossary">
            <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
              Define fixed translations for specific terms (e.g. proper nouns).
            </div>
            {glossaryTerms.length > 0 && (
              <div style={{ marginBottom: '8px' }}>
                {glossaryTerms.map((term, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '4px 0',
                      borderBottom: '1px solid #1e293b',
                      fontSize: '12px'
                    }}
                  >
                    <span style={{ flex: 1, color: '#e2e8f0' }}>{term.source}</span>
                    <span style={{ color: '#64748b' }}>&rarr;</span>
                    <span style={{ flex: 1, color: '#93c5fd' }}>{term.target}</span>
                    <button
                      onClick={() => {
                        const updated = glossaryTerms.filter((_, i) => i !== idx)
                        setGlossaryTerms(updated)
                        window.api.saveGlossary(updated)
                      }}
                      disabled={isRunning}
                      style={{
                        padding: '2px 6px',
                        fontSize: '11px',
                        background: '#334155',
                        color: '#ef4444',
                        border: 'none',
                        borderRadius: '4px',
                        cursor: isRunning ? 'not-allowed' : 'pointer'
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
              <input
                type="text"
                value={newGlossarySource}
                onChange={(e) => setNewGlossarySource(e.target.value)}
                placeholder="Source term"
                style={{ ...inputStyle, flex: 1, fontFamily: 'inherit' }}
                disabled={isRunning}
              />
              <input
                type="text"
                value={newGlossaryTarget}
                onChange={(e) => setNewGlossaryTarget(e.target.value)}
                placeholder="Translation"
                style={{ ...inputStyle, flex: 1, fontFamily: 'inherit' }}
                disabled={isRunning}
              />
              <button
                onClick={() => {
                  if (!newGlossarySource.trim() || !newGlossaryTarget.trim()) return
                  const updated = [...glossaryTerms, { source: newGlossarySource.trim(), target: newGlossaryTarget.trim() }]
                  setGlossaryTerms(updated)
                  window.api.saveGlossary(updated)
                  setNewGlossarySource('')
                  setNewGlossaryTarget('')
                }}
                disabled={isRunning || !newGlossarySource.trim() || !newGlossaryTarget.trim()}
                style={{
                  padding: '8px 12px',
                  fontSize: '12px',
                  fontWeight: 600,
                  background: '#334155',
                  color: '#e2e8f0',
                  border: 'none',
                  borderRadius: '6px',
                  cursor: (isRunning || !newGlossarySource.trim() || !newGlossaryTarget.trim()) ? 'not-allowed' : 'pointer',
                  whiteSpace: 'nowrap'
                }}
              >
                Add
              </button>
            </div>
          </Section>

          {/* Subtitle Appearance */}
          <Section label="Subtitle Appearance">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <div style={sliderLabelStyle}>Font Size: {subtitleFontSize}px</div>
                <input
                  type="range"
                  aria-label="Subtitle font size"
                  min={20}
                  max={48}
                  value={subtitleFontSize}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setSubtitleFontSize(v)
                    pushSubtitleSettings({ fontSize: v })
                  }}
                  style={{ width: '100%' }}
                />
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ flex: 1 }}>
                  <div style={sliderLabelStyle}>Source Text</div>
                  <input
                    type="color"
                    value={subtitleSourceColor}
                    onChange={(e) => {
                      setSubtitleSourceColor(e.target.value)
                      pushSubtitleSettings({ sourceTextColor: e.target.value })
                    }}
                    style={colorInputStyle}
                  />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={sliderLabelStyle}>Translated Text</div>
                  <input
                    type="color"
                    value={subtitleTranslatedColor}
                    onChange={(e) => {
                      setSubtitleTranslatedColor(e.target.value)
                      pushSubtitleSettings({ translatedTextColor: e.target.value })
                    }}
                    style={colorInputStyle}
                  />
                </div>
              </div>
              <div>
                <div style={sliderLabelStyle}>Background Opacity: {subtitleBgOpacity}%</div>
                <input
                  type="range"
                  aria-label="Subtitle background opacity"
                  min={0}
                  max={100}
                  value={subtitleBgOpacity}
                  onChange={(e) => {
                    const v = Number(e.target.value)
                    setSubtitleBgOpacity(v)
                    pushSubtitleSettings({ backgroundOpacity: v })
                  }}
                  style={{ width: '100%' }}
                />
              </div>
              <div>
                <div style={sliderLabelStyle}>Position</div>
                <select
                  value={subtitlePosition}
                  onChange={(e) => {
                    const v = e.target.value as 'top' | 'bottom'
                    setSubtitlePosition(v)
                    pushSubtitleSettings({ position: v })
                  }}
                  style={selectStyle}
                >
                  <option value="bottom">Bottom</option>
                  <option value="top">Top</option>
                </select>
              </div>
            </div>
          </Section>

          {/* Display Selection */}
          <Section label="Subtitle Display">
            <select
              value={selectedDisplay}
              onChange={(e) => handleDisplayChange(Number(e.target.value))}
              style={selectStyle}
              aria-label="Subtitle display"
            >
              {displays.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.label}
                </option>
              ))}
            </select>
          </Section>
        </div>
      )}

      {/* Start/Stop Button — always visible */}
      <button
        aria-label={isRunning ? 'Stop translation' : 'Start translation'}
        onClick={isRunning ? handleStop : handleStart}
        style={{
          ...buttonStyle,
          background: isRunning ? '#dc2626' : isStarting ? '#6b7280' : '#16a34a'
        }}
        disabled={isStarting || (!isRunning && (
          (engineMode === 'online' && !apiKey) ||
          (engineMode === 'online-deepl' && !deeplApiKey) ||
          (engineMode === 'online-gemini' && !geminiApiKey) ||
          (engineMode === 'rotation' && !microsoftApiKey && !apiKey && !deeplApiKey && !geminiApiKey)
        ))}
      >
        {isStarting ? 'Starting...' : isRunning ? '⏹ Stop' : '▶ Start'}
      </button>

      {/* Status */}
      <div style={statusStyle} aria-live="polite">
        <span style={{ color: isRunning ? '#22c55e' : '#64748b' }}>
          {isRunning ? '●' : '○'}
        </span>{' '}
        {status}
        {sessionDuration && (
          <span style={{ marginLeft: '8px', color: '#94a3b8' }}>
            ({sessionDuration})
          </span>
        )}
      </div>

      {/* Meeting Summary */}
      {lastTranscriptPath && !isRunning && (
        <div style={{
          marginTop: '12px',
          background: '#1e293b',
          border: '1px solid #334155',
          borderRadius: '8px',
          padding: '12px 16px'
        }}>
          {!summaryText && !isSummarizing && (
            <button
              onClick={async () => {
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
              }}
              style={{
                ...buttonStyle,
                background: '#6366f1',
                fontSize: '13px',
                padding: '8px',
                marginTop: 0
              }}
            >
              Generate Meeting Summary
            </button>
          )}
          {isSummarizing && (
            <div style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'center' }}>
              Generating summary...
            </div>
          )}
          {summaryText && (
            <div>
              <div style={{ fontSize: '12px', fontWeight: 600, color: '#94a3b8', marginBottom: '8px' }}>
                MEETING SUMMARY
              </div>
              <pre style={{
                fontSize: '12px',
                color: '#e2e8f0',
                whiteSpace: 'pre-wrap',
                lineHeight: 1.5,
                margin: 0
              }}>
                {summaryText}
              </pre>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(summaryText)
                  setStatus('Summary copied to clipboard')
                }}
                style={{
                  ...buttonStyle,
                  background: '#334155',
                  fontSize: '12px',
                  padding: '6px',
                  marginTop: '8px'
                }}
              >
                Copy to Clipboard
              </button>
            </div>
          )}
        </div>
      )}

      {/* Session History */}
      {sessions.length > 0 && (
        <Section label="Session History">
          <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
            {sessions.slice(0, 10).map((s) => (
              <div key={s.id} style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid #1e293b',
                fontSize: '12px'
              }}>
                <div>
                  <div style={{ color: '#e2e8f0' }}>{new Date(s.startedAt).toLocaleString()}</div>
                  <div style={{ color: '#94a3b8' }}>{s.engineMode} — {s.entryCount} entries</div>
                </div>
                <button
                  onClick={async () => {
                    const result = await withIpcTimeout(window.api.exportSession(s.id, 'text'), 10_000, 'exportSession')
                    if (result.content) {
                      navigator.clipboard.writeText(result.content)
                      setStatus('Session exported to clipboard')
                    }
                  }}
                  style={{
                    padding: '4px 8px',
                    fontSize: '11px',
                    background: '#334155',
                    color: '#94a3b8',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer'
                  }}
                >
                  Export
                </button>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  )
}

function Section({ label, children, role }: { label: string; children: React.ReactNode; role?: string }): JSX.Element {
  return (
    <section style={{ marginBottom: '18px' }} role={role} aria-label={label}>
      <label style={sectionLabelStyle}>{label}</label>
      {children}
    </section>
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

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  display: 'block',
  marginBottom: '6px'
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: '13px',
  background: '#1e293b',
  color: '#e2e8f0',
  border: '1px solid #334155',
  borderRadius: '6px'
}

const inputStyle: React.CSSProperties = {
  ...selectStyle,
  fontFamily: 'monospace'
}

const radioLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  fontSize: '13px',
  color: '#e2e8f0',
  cursor: 'pointer',
  padding: '6px 0'
}

const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  fontSize: '15px',
  fontWeight: 700,
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  color: '#fff',
  marginTop: '8px'
}

const sliderLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#94a3b8',
  marginBottom: '4px'
}

const colorInputStyle: React.CSSProperties = {
  width: '100%',
  height: '32px',
  padding: '2px',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '6px',
  cursor: 'pointer'
}

const statusStyle: React.CSSProperties = {
  marginTop: '12px',
  fontSize: '12px',
  color: '#94a3b8',
  textAlign: 'center'
}

export default SettingsPanel
