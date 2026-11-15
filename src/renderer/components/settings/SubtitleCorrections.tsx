import React, { useCallback, useEffect, useState } from 'react'
import { Section } from './Section'
import { buttonStyle } from './shared'

/** Toggles subtitle edit mode, where a translation can be fixed on screen during a meeting. */
export function SubtitleCorrections(): React.JSX.Element {
  const [isEditMode, setIsEditMode] = useState(false)

  useEffect(() => {
    const unsub = window.api.onEditModeChanged?.((enabled: boolean) => setIsEditMode(enabled))
    return () => { unsub?.() }
  }, [])

  const handleToggleEditMode = useCallback(() => {
    const next = !isEditMode
    setIsEditMode(next)
    window.api.toggleSubtitleEditMode?.(next)
  }, [isEditMode])

  return (
    <Section label="Translation Corrections">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
        <div style={{ fontSize: '11px', color: isEditMode ? '#f59e0b' : '#94a3b8' }}>
          {isEditMode && 'Click on translated text in the subtitle overlay to correct it. '}
          Corrections change the subtitle on screen only and are not saved. To fix a term
          from the next sentence on, add it to the glossary.
        </div>
      </div>
    </Section>
  )
}
