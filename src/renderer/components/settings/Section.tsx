import React from 'react'

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  display: 'block',
  marginBottom: '6px'
}

export function Section({ label, children, role, helpText }: { label: string; children: React.ReactNode; role?: string; helpText?: string }): React.JSX.Element {
  return (
    <section style={{ marginBottom: '16px' }} role={role} aria-label={label}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '6px' }}>
        <h2 style={{ ...sectionLabelStyle, marginBottom: 0 }}>{label}</h2>
        {helpText && (
          <span
            title={helpText}
            style={{
              fontSize: '10px',
              color: '#64748b',
              cursor: 'help',
              border: '1px solid #334155',
              borderRadius: '50%',
              width: '16px',
              height: '16px',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
            aria-label={`Help: ${helpText}`}
          >
            ?
          </span>
        )}
      </div>
      {children}
    </section>
  )
}
