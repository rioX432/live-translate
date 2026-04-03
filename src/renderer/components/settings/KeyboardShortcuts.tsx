import React, { useEffect, useState } from 'react'
import { Section } from './Section'

interface ShortcutLabel {
  action: string
  shortcut: string
}

export function KeyboardShortcuts(): React.JSX.Element {
  const [shortcuts, setShortcuts] = useState<Record<string, ShortcutLabel> | null>(null)

  useEffect(() => {
    window.api.getShortcutLabels?.().then(setShortcuts).catch(() => {})
  }, [])

  if (!shortcuts) return <></>

  return (
    <Section label="Keyboard Shortcuts">
      <div style={containerStyle}>
        {Object.values(shortcuts).map((s) => (
          <div key={s.shortcut} style={rowStyle}>
            <span style={actionStyle}>{s.action}</span>
            <kbd style={kbdStyle}>{s.shortcut}</kbd>
          </div>
        ))}
      </div>
    </Section>
  )
}

const containerStyle: React.CSSProperties = {
  background: '#1e293b',
  borderRadius: '6px',
  padding: '8px 12px',
  fontSize: '12px'
}

const rowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '4px 0'
}

const actionStyle: React.CSSProperties = {
  color: '#cbd5e1'
}

const kbdStyle: React.CSSProperties = {
  background: '#334155',
  color: '#e2e8f0',
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '11px',
  fontFamily: 'monospace',
  border: '1px solid #475569'
}
