import React from 'react'
import { Section } from './Section'
import { buttonStyle, withIpcTimeout } from './shared'
import type { EngineMode } from './shared'

interface SessionControlsProps {
  isRunning: boolean
  isStarting: boolean
  engineMode: EngineMode
  apiKey: string
  deeplApiKey: string
  geminiApiKey: string
  microsoftApiKey: string
  status: string
  sessionDuration: string
  onStart: () => void
  onStop: () => void
  // Meeting summary
  lastTranscriptPath: string | null
  summaryText: string | null
  isSummarizing: boolean
  onGenerateSummary: () => void
  onSetStatus: (s: string) => void
  // Session history
  sessions: Array<{ id: string; startedAt: number; engineMode: string; entryCount: number }>
}

export function SessionControls({
  isRunning,
  isStarting,
  engineMode,
  apiKey,
  deeplApiKey,
  geminiApiKey,
  microsoftApiKey,
  status,
  sessionDuration,
  onStart,
  onStop,
  lastTranscriptPath,
  summaryText,
  isSummarizing,
  onGenerateSummary,
  onSetStatus,
  sessions
}: SessionControlsProps): React.JSX.Element {
  return (
    <>
      {/* Start/Stop Button */}
      <button
        aria-label={isRunning ? 'Stop translation' : 'Start translation'}
        onClick={isRunning ? onStop : onStart}
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
        {isStarting ? 'Starting...' : isRunning ? '\u23F9 Stop' : '\u25B6 Start'}
      </button>

      {/* Status */}
      <div style={statusLineStyle} aria-live="polite">
        <span style={{ color: isRunning ? '#22c55e' : '#64748b' }}>
          {isRunning ? '\u25CF' : '\u25CB'}
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
              onClick={onGenerateSummary}
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
                  onSetStatus('Summary copied to clipboard')
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
          <style>{`
            .session-history-scroll::-webkit-scrollbar {
              width: 6px;
            }
            .session-history-scroll::-webkit-scrollbar-track {
              background: transparent;
            }
            .session-history-scroll::-webkit-scrollbar-thumb {
              background: #475569;
              border-radius: 3px;
            }
            .session-history-scroll::-webkit-scrollbar-thumb:hover {
              background: #64748b;
            }
          `}</style>
          <div className="session-history-scroll" style={{ maxHeight: '200px', overflowY: 'auto' }}>
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
                      onSetStatus('Session exported to clipboard')
                    }
                  }}
                  style={{
                    padding: '8px 12px',
                    minHeight: '44px',
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
    </>
  )
}

const statusLineStyle: React.CSSProperties = {
  marginTop: '12px',
  fontSize: '12px',
  color: '#94a3b8',
  textAlign: 'center'
}
