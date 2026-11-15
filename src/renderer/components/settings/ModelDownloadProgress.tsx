import React, { useEffect, useState, useCallback } from 'react'

interface ProgressiveDownloadStatus {
  tier: number | null
  status: string
  progress: number
  tier1Ready: boolean
  tier2Ready: boolean
  currentLabel: string
  currentTierSizeMB: number
  error?: string
}

interface ModelDownloadProgressProps {
  /** Called when user dismisses the onboarding banner */
  onDismiss: () => void
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
  onDismiss
}: ModelDownloadProgressProps): React.JSX.Element | null {
  const [downloadStatus, setDownloadStatus] = useState<ProgressiveDownloadStatus | null>(null)
  const [isFirstRun, setIsFirstRun] = useState(false)
  const [downloading, setDownloading] = useState(false)

  // Load initial status
  useEffect(() => {
    Promise.all([
      window.api.onboardingGetStatus(),
      window.api.onboardingIsFirstRun()
    ]).then(([status, firstRun]) => {
      setDownloadStatus(status as ProgressiveDownloadStatus)
      setIsFirstRun(firstRun)
      if (status.status === 'downloading-tier1' || status.status === 'downloading-tier2') {
        setDownloading(true)
      }
    }).catch((err: unknown) => {
      const e = err instanceof Error ? err : new Error(String(err))
      console.warn('[model-download] Failed to load onboarding status:', e.message)
    })
  }, [])

  // Listen for progress updates
  useEffect(() => {
    const unsub = window.api.onOnboardingDownloadProgress((data) => {
      setDownloadStatus((prev) => {
        if (!prev) return null
        return {
          ...prev,
          status: data.status,
          progress: data.progress,
          tier: data.tier ?? prev.tier,
          tier1Ready: data.tier1Ready ?? prev.tier1Ready,
          tier2Ready: data.tier2Ready ?? prev.tier2Ready,
          error: data.error
        }
      })

      if (data.status === 'all-ready' || data.status === 'failed') {
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

  if (!isFirstRun || !downloadStatus) return null

  const { status, progress, tier1Ready, currentLabel, currentTierSizeMB } = downloadStatus

  // The engines are fixed, so once their models are on disk there is nothing to switch to
  if (tier1Ready || status === 'all-ready') return null

  // Download failed
  if (status === 'failed') {
    return (
      <div style={bannerStyle} role="alert">
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#f87171', marginBottom: '6px' }}>
          Model download failed
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>
          Failed to download offline models. You can retry once you are back online.
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

  if (status === 'downloading-tier1' || status === 'downloading-tier2' || downloading) {
    return (
      <div style={bannerStyle} role="status" aria-live="polite">
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#60a5fa', marginBottom: '4px' }}>
          Downloading models...
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8' }}>
          {currentLabel} (~{currentTierSizeMB}MB)
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
        <div style={{ fontSize: '11px', color: '#94a3b8' }}>
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
        Download {currentLabel} (~{currentTierSizeMB}MB) to translate fully on this device.
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
