import React from 'react'

interface CrashRecoveryBannerProps {
  isStarting: boolean
  onResume: () => void
  onDismiss: () => void
}

export function CrashRecoveryBanner({ isStarting, onResume, onDismiss }: CrashRecoveryBannerProps): React.JSX.Element {
  return (
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
          onClick={onResume}
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
          onClick={onDismiss}
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
  )
}
