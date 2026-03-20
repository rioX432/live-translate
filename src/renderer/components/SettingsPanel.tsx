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
  const [engineMode, setEngineMode] = useState<EngineMode>('auto')
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

  const [isStarting, setIsStarting] = useState(false) // #31: double-click guard

  // Subtitle customization (#118)
  // STT engine selection (#119)
  const [sttEngine, setSttEngine] = useState<'whisper-local' | 'mlx-whisper' | 'moonshine'>('whisper-local')

  const [subtitleFontSize, setSubtitleFontSize] = useState(30)
  const [subtitleSourceColor, setSubtitleSourceColor] = useState('#ffffff')
  const [subtitleTranslatedColor, setSubtitleTranslatedColor] = useState('#7dd3fc')
  const [subtitleBgOpacity, setSubtitleBgOpacity] = useState(78)
  const [subtitlePosition, setSubtitlePosition] = useState<'top' | 'bottom'>('bottom')

  // Session history (#144)
  const [sessions, setSessions] = useState<Array<{ id: string; startedAt: number; engineMode: string; entryCount: number }>>([])

  // KV cache quantization (#237)
  const [slmKvCacheQuant, setSlmKvCacheQuant] = useState(true)

  // Model size (#236)
  const [slmModelSize, setSlmModelSize] = useState<'4b' | '12b'>('4b')

  // Speculative decoding (#238)
  const [slmSpeculativeDecoding, setSlmSpeculativeDecoding] = useState(false)
  const [draftModelAvailable, setDraftModelAvailable] = useState(false)

  // SimulMT (#239)
  const [simulMtEnabled, setSimulMtEnabled] = useState(false)
  const [simulMtWaitK, setSimulMtWaitK] = useState(3)

  // Glossary (#240)
  const [glossaryTerms, setGlossaryTerms] = useState<Array<{ source: string; target: string }>>([])
  const [newGlossarySource, setNewGlossarySource] = useState('')
  const [newGlossaryTarget, setNewGlossaryTarget] = useState('')

  // #243: Platform detection for hiding macOS-only options
  const [platform, setPlatform] = useState<string>('darwin')

  // Meeting summary (#124)
  const [lastTranscriptPath, setLastTranscriptPath] = useState<string | null>(null)
  const [summaryText, setSummaryText] = useState<string | null>(null)
  const [isSummarizing, setIsSummarizing] = useState(false)

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

  // Load saved settings on mount (#49) and check for crashed session (#54)
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
    })

    // #243: detect platform to hide macOS-only options
    window.api.getPlatform().then(setPlatform).catch(() => {})

    // #54: check for crashed session
    window.api.getCrashedSession().then((session) => {
      if (session) {
        setCrashedSession(session)
        setStatus('Previous session ended unexpectedly. Resume?')
      }
    })
  }, [])

  // Load session history (#144)
  useEffect(() => {
    window.api.listSessions().then(setSessions).catch(() => {})
  }, [isRunning])

  // Detect GPU (#132)
  useEffect(() => {
    window.api.detectGpu().then(setGpuInfo).catch(() => setGpuInfo({ hasGpu: false, gpuNames: [] }))
  }, [])

  // Check if 4B draft model is available for speculative decoding (#238)
  useEffect(() => {
    window.api.isDraftModelAvailable().then(setDraftModelAvailable).catch(() => setDraftModelAvailable(false))
  }, [slmModelSize])

  // Load displays and listen for display changes (#192)
  useEffect(() => {
    const refreshDisplays = (): void => {
      window.api.getDisplays().then((d) => {
        setDisplays(d)
        // #45: safely default to external display if available
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
    if (isStarting) return // #31: prevent double-click
    setIsStarting(true)

    try {
      setStatus('Starting pipeline...')

      // Persist settings (#49)
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
        setIsStarting(false) // #36: reset on error
        return
      }

      await audio.start()
      setIsRunning(true)
      startSessionTimer()
      setStatus('Listening...')
    } catch (err) {
      setStatus(`Error: ${err}`)
      setIsRunning(false) // #36: reset on error
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

  // #54: resume crashed session
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
      setCrashedSession(null) // only clear on success
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

  return (
    <div style={containerStyle}>
      <h1 style={titleStyle}>live-translate</h1>

      {/* #54: Crash recovery banner */}
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

      {/* Microphone Selection */}
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
        {audio.hasVirtualAudioDevice && (
          <div style={{ marginTop: '6px', fontSize: '11px', color: '#22c55e' }}>
            Virtual audio device detected — select it above to capture Zoom/Teams audio
          </div>
        )}
        {!audio.hasVirtualAudioDevice && (
          <div style={{ marginTop: '6px', fontSize: '11px', color: '#94a3b8' }}>
            {platform === 'win32'
              ? 'To capture Zoom/Teams audio, enable Stereo Mix in Sound settings or install VB-Audio Virtual Cable'
              : 'To capture Zoom/Teams audio, install BlackHole (free) and select it as the input device'}
          </div>
        )}
      </Section>

      {/* STT Engine (#119) */}
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
        {sttEngine === 'mlx-whisper' && (
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
            Requires Python 3 + mlx-whisper: pip install mlx-whisper
          </div>
        )}
      </Section>

      {/* Engine Selection */}
      <Section label="Translation Engine" role="radiogroup">
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'auto'}
            onChange={() => setEngineMode('auto')}
            disabled={isRunning || isStarting}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Auto (Recommended)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              {gpuInfo
                ? gpuInfo.hasGpu
                  ? `GPU detected: ${gpuInfo.gpuNames.join(', ')}`
                  : 'No GPU detected — will use OPUS-MT or API rotation'
                : 'Detecting hardware...'}
            </div>
          </div>
        </label>

        <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '10px', marginBottom: '4px' }}>
          API Translation
        </div>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'rotation'}
            onChange={() => setEngineMode('rotation')}
            disabled={isRunning || isStarting}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Auto Rotation (Recommended) — up to 4M+ chars/month free</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Azure → Google → DeepL → Gemini, auto-fallback on quota</div>
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
          <div>
            <div style={{ fontWeight: 500 }}>Google Translation</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>JA↔EN, high quality, requires internet</div>
          </div>
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'online-deepl'}
            onChange={() => setEngineMode('online-deepl')}
            disabled={isRunning || isStarting}
          />
          <div>
            <div style={{ fontWeight: 500 }}>DeepL</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>JA↔EN, high quality, 500K chars/month free</div>
          </div>
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'online-gemini'}
            onChange={() => setEngineMode('online-gemini')}
            disabled={isRunning || isStarting}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Gemini 2.5 Flash</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>JA↔EN, LLM-based, generous free tier</div>
          </div>
        </label>

        <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '10px', marginBottom: '4px' }}>
          Offline
        </div>
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
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>JA↔EN, no internet, ~100MB model download</div>
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
            <div style={{ fontWeight: 500 }}>OPUS-MT (CTranslate2 Accelerated)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>JA↔EN, 6-10x faster than standard OPUS-MT, requires Python 3</div>
          </div>
        </label>
        {engineMode === 'offline-ct2-opus' && (
          <div style={{ paddingLeft: '24px', fontSize: '11px', color: '#94a3b8', marginTop: '-4px', marginBottom: '4px' }}>
            Requires: pip install ctranslate2 transformers sentencepiece
          </div>
        )}
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
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>JA↔EN, GPU-accelerated offline translation</div>
            {engineMode === 'offline-slm' && gpuInfo && !gpuInfo.hasGpu && (
              <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '2px' }}>
                No GPU detected — translation may be slow on CPU-only systems
              </div>
            )}
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
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>JA↔EN, 33 languages, GPU-accelerated, ~4.7GB download</div>
            {engineMode === 'offline-hunyuan-mt' && gpuInfo && !gpuInfo.hasGpu && (
              <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '2px' }}>
                No GPU detected — translation may be slow on CPU-only systems
              </div>
            )}
          </div>
        </label>
        {(engineMode === 'offline-slm' || engineMode === 'offline-hunyuan-mt' || engineMode === 'offline-hybrid') && (
          <>
            <div style={{ paddingLeft: '24px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
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
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Good quality, runs on most GPUs</div>
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
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>Best offline quality, requires M3 Pro+ or 8GB+ VRAM</div>
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
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Reduces VRAM usage ~50% with negligible quality impact
                </div>
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
                  <div style={{ fontWeight: 500, fontSize: '12px' }}>
                    Speculative decoding (4B draft + 12B verify)
                  </div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    2-3x throughput with identical output quality. Requires both models in VRAM (~10GB).
                  </div>
                  {!draftModelAvailable && (
                    <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '2px' }}>
                      Download the 4B model first (select 4B, start once, then switch back to 12B)
                    </div>
                  )}
                </div>
              </label>
            )}
            {/* SimulMT (#239) */}
            <label style={{ ...radioLabelStyle, paddingLeft: '24px' }}>
              <input
                type="checkbox"
                checked={simulMtEnabled}
                onChange={(e) => setSimulMtEnabled(e.target.checked)}
                disabled={isRunning || isStarting}
              />
              <div>
                <div style={{ fontWeight: 500, fontSize: '12px' }}>
                  Simultaneous translation (SimulMT)
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Start translating before the speaker finishes. Lower latency, requires offline LLM engine.
                </div>
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
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '10px', color: '#64748b' }}>
                  <span>1 (faster, less stable)</span>
                  <span>10 (slower, more stable)</span>
                </div>
              </div>
            )}
          </>
        )}
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
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Instant OPUS-MT draft + LLM refinement for best quality</div>
            {engineMode === 'offline-hybrid' && gpuInfo && !gpuInfo.hasGpu && (
              <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '2px' }}>
                No GPU detected — LLM refinement may be slow on CPU-only systems
              </div>
            )}
          </div>
        </label>
      </Section>

      {/* API Keys */}
      {engineMode === 'rotation' && (
        <Section label="API Keys (provide at least one)">
          {!microsoftApiKey && !apiKey && !deeplApiKey && !geminiApiKey && (
            <div style={{
              background: '#1e293b',
              border: '1px solid #3b82f6',
              borderRadius: '6px',
              padding: '10px 12px',
              marginBottom: '8px',
              fontSize: '12px',
              color: '#93c5fd',
              lineHeight: 1.5
            }}>
              Add API keys from any combination of providers below. Each provider offers a free tier — combined, you get 4M+ characters/month at no cost.
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Google Cloud Translation key"
              style={inputStyle}
              disabled={isRunning || isStarting}
            />
            <input
              type="password"
              value={deeplApiKey}
              onChange={(e) => setDeeplApiKey(e.target.value)}
              placeholder="DeepL API key"
              style={inputStyle}
              disabled={isRunning || isStarting}
            />
            <input
              type="password"
              value={geminiApiKey}
              onChange={(e) => setGeminiApiKey(e.target.value)}
              placeholder="Gemini API key"
              style={inputStyle}
              disabled={isRunning || isStarting}
            />
          </div>
        </Section>
      )}
      {engineMode === 'online' && (
        <Section label="Google Cloud Translation API Key">
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="Enter API key..."
            style={inputStyle}
            disabled={isRunning || isStarting}
          />
        </Section>
      )}
      {engineMode === 'online-deepl' && (
        <Section label="DeepL API Key">
          <input
            type="password"
            value={deeplApiKey}
            onChange={(e) => setDeeplApiKey(e.target.value)}
            placeholder="Enter DeepL API key..."
            style={inputStyle}
            disabled={isRunning || isStarting}
          />
        </Section>
      )}
      {engineMode === 'online-gemini' && (
        <Section label="Gemini API Key">
          <input
            type="password"
            value={geminiApiKey}
            onChange={(e) => setGeminiApiKey(e.target.value)}
            placeholder="Enter Gemini API key..."
            style={inputStyle}
            disabled={isRunning || isStarting}
          />
        </Section>
      )}

      {/* Glossary (#240) */}
      <Section label="Translation Glossary">
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
          Define fixed translations for specific terms. These are injected into LLM-based translators (Gemini, TranslateGemma).
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

      {/* Subtitle Appearance (#118) */}
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

      {/* Start/Stop Button */}
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

      {/* Meeting Summary (#124) */}
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

      {/* Session History (#144) */}
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
