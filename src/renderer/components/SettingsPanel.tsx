import { useState } from 'react'

function SettingsPanel(): JSX.Element {
  const [isRunning, setIsRunning] = useState(false)
  const [engineMode, setEngineMode] = useState<'online' | 'offline'>('online')

  return (
    <div style={{ padding: '24px', fontFamily: '-apple-system, sans-serif', color: '#e5e5e5', background: '#1a1a2e', minHeight: '100vh' }}>
      <h1 style={{ fontSize: '20px', fontWeight: 700, marginBottom: '24px', color: '#fff' }}>
        🌐 live-translate
      </h1>

      <section style={{ marginBottom: '20px' }}>
        <label style={{ fontSize: '14px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
          Microphone
        </label>
        <select style={selectStyle}>
          <option>Default Microphone</option>
        </select>
      </section>

      <section style={{ marginBottom: '20px' }}>
        <label style={{ fontSize: '14px', color: '#94a3b8', display: 'block', marginBottom: '8px' }}>
          Translation Engine
        </label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <label style={radioLabelStyle}>
            <input
              type="radio"
              name="engine"
              checked={engineMode === 'online'}
              onChange={() => setEngineMode('online')}
            />
            <span>Online — Whisper STT + Google Translation</span>
          </label>
          <label style={radioLabelStyle}>
            <input
              type="radio"
              name="engine"
              checked={engineMode === 'offline'}
              onChange={() => setEngineMode('offline')}
            />
            <span>Offline — Whisper Translate (JA→EN only)</span>
          </label>
        </div>
      </section>

      <section style={{ marginBottom: '20px' }}>
        <label style={{ fontSize: '14px', color: '#94a3b8', display: 'block', marginBottom: '6px' }}>
          Subtitle Display
        </label>
        <select style={selectStyle}>
          <option>Display 1 (Main)</option>
          <option>Display 2 (External)</option>
        </select>
      </section>

      <button
        onClick={() => setIsRunning(!isRunning)}
        style={{
          width: '100%',
          padding: '12px',
          fontSize: '16px',
          fontWeight: 700,
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          background: isRunning ? '#ef4444' : '#22c55e',
          color: '#fff',
          transition: 'background 0.2s'
        }}
      >
        {isRunning ? '⏹ Stop' : '▶ Start'}
      </button>

      <div style={{ marginTop: '16px', fontSize: '12px', color: '#64748b', textAlign: 'center' }}>
        {isRunning ? '🔴 Listening...' : 'Ready'}
      </div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: '14px',
  background: '#16213e',
  color: '#e5e5e5',
  border: '1px solid #334155',
  borderRadius: '6px',
  outline: 'none'
}

const radioLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '14px',
  color: '#e5e5e5',
  cursor: 'pointer'
}

export default SettingsPanel
