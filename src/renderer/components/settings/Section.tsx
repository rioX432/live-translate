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

export function Section({ label, children, role }: { label: string; children: React.ReactNode; role?: string }): React.JSX.Element {
  return (
    <section style={{ marginBottom: '18px' }} role={role} aria-label={label}>
      <label style={sectionLabelStyle}>{label}</label>
      {children}
    </section>
  )
}
