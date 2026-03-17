import { useCallback, useEffect, useRef, useState } from 'react'
import { useAudioCapture } from '../hooks/useAudioCapture'

type EngineMode = 'rotation' | 'online' | 'online-deepl' | 'online-gemini' | 'offline-e2e' | 'offline-opus'

interface DisplayInfo {
  id: number
  label: string
}

function SettingsPanel(): JSX.Element {
  const [engineMode, setEngineMode] = useState<EngineMode>('online')
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

  // Load displays
  useEffect(() => {
    window.api.getDisplays().then((d) => {
      setDisplays(d)
      if (d.length > 1) setSelectedDisplay(d[1].id) // Default to external display
    })
  }, [])

  // Handle audio: streaming chunks during speech, final segment on speech end
  useEffect(() => {
    // Legacy: VAD speech end → final processing (non-streaming fallback for e2e mode)
    audio.onAudioChunk((chunk) => {
      window.api.processAudio(Array.from(chunk))
    })

    // Streaming: periodic rolling buffer during speech
    audio.onStreamingChunk((buffer) => {
      window.api.processAudioStreaming(Array.from(buffer))
    })

    // Streaming: finalize when speech ends
    audio.onSpeechSegmentEnd((finalBuffer) => {
      window.api.finalizeStreaming(Array.from(finalBuffer))
    })
  }, [audio])

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
    try {
      setStatus('Starting pipeline...')

      // Build engine config
      let config: Record<string, unknown>
      if (engineMode === 'rotation') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: 'whisper-local',
          translatorEngineId: 'rotation-controller',
          ...(apiKey && { apiKey }),
          ...(deeplApiKey && { deeplApiKey }),
          ...(microsoftApiKey && microsoftRegion && { microsoftApiKey, microsoftRegion })
        }
      } else if (engineMode === 'online') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: 'whisper-local',
          translatorEngineId: 'google-translate',
          apiKey
        }
      } else if (engineMode === 'online-deepl') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: 'whisper-local',
          translatorEngineId: 'deepl-translate',
          deeplApiKey
        }
      } else if (engineMode === 'online-gemini') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: 'whisper-local',
          translatorEngineId: 'gemini-translate',
          geminiApiKey
        }
      } else if (engineMode === 'offline-opus') {
        config = {
          mode: 'cascade' as const,
          sttEngineId: 'whisper-local',
          translatorEngineId: 'opus-mt'
        }
      } else {
        config = {
          mode: 'e2e' as const,
          e2eEngineId: 'whisper-translate'
        }
      }

      const result = await window.api.pipelineStart(config)
      if (result.error) {
        setStatus(`Error: ${result.error}`)
        return
      }

      await audio.start()
      setIsRunning(true)
      startSessionTimer()
      setStatus('Listening...')
    } catch (err) {
      setStatus(`Error: ${err}`)
    }
  }

  const handleStop = async (): Promise<void> => {
    audio.stop()
    stopSessionTimer()
    const result = await window.api.pipelineStop()
    setIsRunning(false)
    setStatus(result.logPath ? `Saved: ${result.logPath}` : 'Stopped')
  }

  const handleDisplayChange = (displayId: number): void => {
    setSelectedDisplay(displayId)
    window.api.moveSubtitleToDisplay(displayId)
  }

  return (
    <div style={containerStyle}>
      <h1 style={titleStyle}>live-translate</h1>

      {/* Microphone Selection */}
      <Section label="Microphone">
        <select
          value={audio.selectedDevice}
          onChange={(e) => audio.setSelectedDevice(e.target.value)}
          style={selectStyle}
          disabled={isRunning}
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
      </Section>

      {/* Engine Selection */}
      <Section label="Translation Engine">
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'rotation'}
            onChange={() => setEngineMode('rotation')}
            disabled={isRunning}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Auto Rotation — 3M chars/month free</div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>Azure → Google → DeepL, auto-fallback on quota</div>
          </div>
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'online'}
            onChange={() => setEngineMode('online')}
            disabled={isRunning}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Online — Whisper + Google Translation</div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>JA↔EN, high quality, requires internet</div>
          </div>
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'online-deepl'}
            onChange={() => setEngineMode('online-deepl')}
            disabled={isRunning}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Online — Whisper + DeepL</div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>JA↔EN, high quality, 500K chars/month free</div>
          </div>
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'online-gemini'}
            onChange={() => setEngineMode('online-gemini')}
            disabled={isRunning}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Online — Whisper + Gemini 2.5 Flash</div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>JA↔EN, LLM-based, generous free tier</div>
          </div>
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'offline-opus'}
            onChange={() => setEngineMode('offline-opus')}
            disabled={isRunning}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Offline — Whisper + OPUS-MT</div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>JA↔EN, no internet, ~100MB model download</div>
          </div>
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'offline-e2e'}
            onChange={() => setEngineMode('offline-e2e')}
            disabled={isRunning}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Offline — Whisper Translate</div>
            <div style={{ fontSize: '12px', color: '#64748b' }}>JA→EN only, no internet required</div>
          </div>
        </label>
      </Section>

      {/* API Keys */}
      {engineMode === 'rotation' && (
        <Section label="API Keys (provide at least one)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <input
              type="password"
              value={microsoftApiKey}
              onChange={(e) => setMicrosoftApiKey(e.target.value)}
              placeholder="Azure Microsoft Translator key"
              style={inputStyle}
              disabled={isRunning}
            />
            <input
              type="text"
              value={microsoftRegion}
              onChange={(e) => setMicrosoftRegion(e.target.value)}
              placeholder="Azure region (e.g. eastus)"
              style={inputStyle}
              disabled={isRunning}
            />
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Google Cloud Translation key"
              style={inputStyle}
              disabled={isRunning}
            />
            <input
              type="password"
              value={deeplApiKey}
              onChange={(e) => setDeeplApiKey(e.target.value)}
              placeholder="DeepL API key"
              style={inputStyle}
              disabled={isRunning}
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
            disabled={isRunning}
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
            disabled={isRunning}
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
            disabled={isRunning}
          />
        </Section>
      )}

      {/* Display Selection */}
      <Section label="Subtitle Display">
        <select
          value={selectedDisplay}
          onChange={(e) => handleDisplayChange(Number(e.target.value))}
          style={selectStyle}
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
        onClick={isRunning ? handleStop : handleStart}
        style={{
          ...buttonStyle,
          background: isRunning ? '#dc2626' : '#16a34a'
        }}
        disabled={!isRunning && (
          (engineMode === 'online' && !apiKey) ||
          (engineMode === 'online-deepl' && !deeplApiKey) ||
          (engineMode === 'online-gemini' && !geminiApiKey) ||
          (engineMode === 'rotation' && !microsoftApiKey && !apiKey && !deeplApiKey)
        )}
      >
        {isRunning ? '⏹ Stop' : '▶ Start'}
      </button>

      {/* Status */}
      <div style={statusStyle}>
        <span style={{ color: isRunning ? '#22c55e' : '#64748b' }}>
          {isRunning ? '●' : '○'}
        </span>{' '}
        {status}
        {sessionDuration && (
          <span style={{ marginLeft: '8px', color: '#64748b' }}>
            ({sessionDuration})
          </span>
        )}
      </div>
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }): JSX.Element {
  return (
    <section style={{ marginBottom: '18px' }}>
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
  borderRadius: '6px',
  outline: 'none'
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

const statusStyle: React.CSSProperties = {
  marginTop: '12px',
  fontSize: '12px',
  color: '#94a3b8',
  textAlign: 'center'
}

export default SettingsPanel
