import React, { useEffect, useState, useCallback } from 'react'

interface DownloadStatus {
  status: string
  progress: number
  preferredEngine: string
  modelReady: boolean
  targetLabel: string
  targetSizeMB: number
}

interface ModelDownloadProgressProps {
  /** Called when user accepts switching to local engine */
  onSwitchToLocal: (engineMode: string) => void
  /** Called when user dismisses the onboarding banner */
  onDismiss: () => void
  /** Whether the pipeline is currently running */
  disabled: boolean
}

const progressBarContainerStyle: React.CSSProperties = {
  width: '100%',
  height: '6px',
  background: '#1e293b',
  borderRadius: '3px',
  overflow: 'hidden',
  marginTop: '8px',
  marginBottom: '4px'
}

const bannerStyle: React.CSSProperties = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '8px',
  padding: '12px 16px',
  marginBottom: '12px'
}

const buttonBaseStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: '12px',
  fontWeight: 600,
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer'
}

export function ModelDownloadProgress({
  onSwitchToLocal,
  onDismiss,
  disabled
}: ModelDownloadProgressProps): React.JSX.Element | null {
  const [downloadStatus, setDownloadStatus] = useState<DownloadStatus | null>(null)
  const [isFirstRun, setIsFirstRun] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [switchedToLocal, setSwitchedToLocal] = useState(false)

  // Load initial status
  useEffect(() => {
    Promise.all([
      window.api.onboardingGetStatus(),
      window.api.onboardingIsFirstRun()
    ]).then(([status, firstRun]) => {
      setDownloadStatus(status)
      setIsFirstRun(firstRun)
      if (status.status === 'downloading') setDownloading(true)
    }).catch((err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err))
      console.warn('[model-download] Failed to load onboarding status:', e.message)
    })
  }, [])

  // Listen for progress updates
  useEffect(() => {
    const unsub = window.api.onOnboardingDownloadProgress((data) => {
      setDownloadStatus((prev) => prev ? {
        ...prev,
        status: data.status,
        progress: data.progress,
        modelReady: data.status === 'completed'
      } : null)

      if (data.status === 'completed' || data.status === 'failed') {
        setDownloading(false)
      }
    })
    return () => { unsub() }
  }, [])

  const handleStartDownload = useCallback(async () => {
    setDownloading(true)
    try {
      await window.api.onboardingStartDownload()
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      console.warn('[model-download] Failed to start download:', e.message)
      setDownloading(false)
    }
  }, [])

  const handleSwitchToLocal = useCallback(async () => {
    try {
      const result = await window.api.onboardingSwitchToLocal()
      if (result.success && result.engine) {
        setSwitchedToLocal(true)
        onSwitchToLocal(result.engine)
      }
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      console.warn('[model-download] Failed to switch to local engine:', e.message)
    }
  }, [onSwitchToLocal])

  const handleDismiss = useCallback(async () => {
    try {
      await window.api.onboardingDismiss()
      setIsFirstRun(false)
      onDismiss()
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      console.warn('[model-download] Failed to dismiss onboarding:', e.message)
    }
  }, [onDismiss])

  // Don't show if not first run or already switched
  if (!isFirstRun || switchedToLocal) return null
  if (!downloadStatus) return null

  const { status, progress, targetLabel, targetSizeMB, modelReady } = downloadStatus

  // Model already ready — show switch prompt
  if (modelReady && status === 'completed') {
    return (
      <div style={bannerStyle} role="status" aria-live="polite">
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#4ade80', marginBottom: '6px' }}>
          Local model ready
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>
          {targetLabel} has been downloaded. Switch to offline translation for faster, private results.
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleSwitchToLocal}
            disabled={disabled}
            style={{
              ...buttonBaseStyle,
              background: '#22c55e',
              color: '#fff'
            }}
          >
            Switch to {targetLabel}
          </button>
          <button
            onClick={handleDismiss}
            style={{
              ...buttonBaseStyle,
              background: '#334155',
              color: '#94a3b8'
            }}
          >
            Keep cloud
          </button>
        </div>
      </div>
    )
  }

  // Download failed
  if (status === 'failed') {
    return (
      <div style={bannerStyle} role="alert">
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#f87171', marginBottom: '6px' }}>
          Model download failed
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>
          Failed to download {targetLabel}. You can retry or continue with cloud translation.
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleStartDownload}
            disabled={downloading}
            style={{
              ...buttonBaseStyle,
              background: '#3b82f6',
              color: '#fff'
            }}
          >
            Retry download
          </button>
          <button
            onClick={handleDismiss}
            style={{
              ...buttonBaseStyle,
              background: '#334155',
              color: '#94a3b8'
            }}
          >
            Dismiss
          </button>
        </div>
      </div>
    )
  }

  // Downloading in progress
  if (status === 'downloading' || downloading) {
    return (
      <div style={bannerStyle} role="status" aria-live="polite">
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#60a5fa', marginBottom: '4px' }}>
          Downloading offline model...
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8' }}>
          {targetLabel} (~{targetSizeMB}MB) — translation works via cloud while downloading
        </div>
        <div style={progressBarContainerStyle}>
          <div
            style={{
              width: `${Math.max(progress, 2)}%`,
              height: '100%',
              background: '#3b82f6',
              borderRadius: '3px',
              transition: 'width 0.3s ease'
            }}
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
        <div style={{ fontSize: '11px', color: '#64748b' }}>
          {progress}% complete
        </div>
      </div>
    )
  }

  // Idle — show download prompt
  return (
    <div style={bannerStyle} role="status">
      <div style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0', marginBottom: '4px' }}>
        Offline translation available
      </div>
      <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>
        Download {targetLabel} (~{targetSizeMB}MB) for faster, private offline translation.
        Cloud translation continues to work while downloading.
      </div>
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
        <button
          onClick={handleStartDownload}
          disabled={downloading}
          style={{
            ...buttonBaseStyle,
            background: '#3b82f6',
            color: '#fff'
          }}
        >
          Download now
        </button>
        <button
          onClick={handleDismiss}
          style={{
            ...buttonBaseStyle,
            background: '#334155',
            color: '#94a3b8'
          }}
        >
          Skip
        </button>
      </div>
    </div>
  )
}
