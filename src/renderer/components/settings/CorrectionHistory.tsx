import React, { useCallback, useEffect, useState } from 'react'
import { Section } from './Section'
import { buttonStyle } from './shared'

interface CorrectionEntry {
  sourceText: string
  originalTranslation: string
  correctedTranslation: string
  timestamp: number
}

export function CorrectionHistory(): React.JSX.Element {
  const [history, setHistory] = useState<CorrectionEntry[]>([])
  const [isEditMode, setIsEditMode] = useState(false)

  const loadHistory = useCallback(() => {
    window.api.getCorrectionHistory?.().then(setHistory).catch((err) => console.warn('Failed to load correction history:', err))
  }, [])

  useEffect(() => {
    loadHistory()

    // Reload history when edit mode changes (user may have just saved a correction)
    const unsub = window.api.onEditModeChanged?.((enabled: boolean) => {
      setIsEditMode(enabled)
      if (!enabled) loadHistory()
    })
    return () => { unsub?.() }
  }, [loadHistory])

  const handleToggleEditMode = useCallback(() => {
    const next = !isEditMode
    setIsEditMode(next)
    window.api.toggleSubtitleEditMode?.(next)
  }, [isEditMode])

  const handleClearHistory = useCallback(() => {
    window.api.clearCorrectionHistory?.().then(() => {
      setHistory([])
    }).catch((err) => console.warn('Failed to clear correction history:', err))
  }, [])

  return (
    <Section label="Translation Corrections">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {/* Toggle edit mode button */}
        <button
          onClick={handleToggleEditMode}
          style={{
            ...buttonStyle,
            fontSize: '13px',
            padding: '8px 12px',
            marginTop: 0,
            background: isEditMode ? '#dc2626' : '#334155',
            fontWeight: 600
          }}
        >
          {isEditMode ? 'Exit Edit Mode' : 'Edit Translations'}
        </button>
        {isEditMode && (
          <div style={{ fontSize: '11px', color: '#f59e0b' }}>
            Click on translated text in the subtitle overlay to correct it.
            Corrections are saved as glossary entries.
          </div>
        )}

        {/* Correction history */}
        {history.length > 0 ? (
          <div style={historyContainerStyle}>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '6px'
            }}>
              <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                {history.length} correction{history.length !== 1 ? 's' : ''}
              </span>
              <button
                onClick={handleClearHistory}
                style={clearButtonStyle}
              >
                Clear
              </button>
            </div>
            {history.slice(-10).reverse().map((entry, i) => (
              <div key={`${entry.timestamp}-${i}`} style={entryStyle}>
                <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '2px' }}>
                  {new Date(entry.timestamp).toLocaleTimeString()}
                </div>
                <div style={{ fontSize: '12px', color: '#e2e8f0' }}>
                  {entry.sourceText}
                </div>
                <div style={{ fontSize: '11px' }}>
                  <span style={{ color: '#f87171', textDecoration: 'line-through' }}>
                    {entry.originalTranslation}
                  </span>
                  {' → '}
                  <span style={{ color: '#34d399' }}>
                    {entry.correctedTranslation}
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ fontSize: '11px', color: '#64748b' }}>
            No corrections yet. Use Edit Mode to correct translations.
          </div>
        )}
      </div>
    </Section>
  )
}

const historyContainerStyle: React.CSSProperties = {
  background: '#1e293b',
  borderRadius: '6px',
  padding: '8px 12px',
  maxHeight: '200px',
  overflowY: 'auto'
}

const entryStyle: React.CSSProperties = {
  padding: '6px 0',
  borderBottom: '1px solid #334155'
}

const clearButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#64748b',
  border: '1px solid #475569',
  borderRadius: '4px',
  padding: '6px 12px',
  fontSize: '11px',
  cursor: 'pointer'
}
