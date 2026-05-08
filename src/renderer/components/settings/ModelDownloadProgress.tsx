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

const tierBadgeStyle = (ready: boolean): React.CSSProperties => ({
  display: 'inline-block',
  padding: '2px 6px',
  fontSize: '10px',
  fontWeight: 700,
  borderRadius: '4px',
  background: ready ? '#166534' : '#1e293b',
  color: ready ? '#4ade80' : '#64748b',
  border: `1px solid ${ready ? '#22c55e' : '#475569'}`,
  marginRight: '6px'
})

export function ModelDownloadProgress({
  onSwitchToLocal,
  onDismiss,
  disabled
}: ModelDownloadProgressProps): React.JSX.Element | null {
  const [downloadStatus, setDownloadStatus] = useState<ProgressiveDownloadStatus | null>(null)
  const [isFirstRun, setIsFirstRun] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [switchedToLocal, setSwitchedToLocal] = useState(false)
  const [upgradedToTier2, setUpgradedToTier2] = useState(false)

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
      // Tier 1 just became ready — stop showing "downloading" spinner
      if (data.status === 'tier1-ready') {
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

  const handleSwitchToTier1 = useCallback(async () => {
    try {
      const result = await window.api.onboardingSwitchToLocal()
      if (result.success && result.engine) {
        setSwitchedToLocal(true)
        onSwitchToLocal(result.engine)
      }
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      console.warn('[model-download] Failed to switch to Tier 1:', e.message)
    }
  }, [onSwitchToLocal])

  const handleUpgradeToTier2 = useCallback(async () => {
    try {
      const result = await window.api.onboardingUpgradeToTier2()
      if (result.success && result.engine) {
        setUpgradedToTier2(true)
        onSwitchToLocal(result.engine)
      }
    } catch (err: unknown) {
      const e = err instanceof Error ? err : new Error(String(err))
      console.warn('[model-download] Failed to upgrade to Tier 2:', e.message)
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

  // Don't show if not first run or fully dismissed
  if (!isFirstRun || upgradedToTier2) return null
  if (!downloadStatus) return null

  const { status, progress, tier1Ready, tier2Ready } = downloadStatus

  // All models ready — show upgrade prompt
  if (tier1Ready && tier2Ready && status === 'all-ready') {
    if (switchedToLocal) {
      // User is on Tier 1, Tier 2 is now ready — prompt upgrade
      return (
        <div style={bannerStyle} role="status" aria-live="polite">
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
            <span style={tierBadgeStyle(true)}>Tier 1</span>
            <span style={tierBadgeStyle(true)}>Tier 2</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#4ade80' }}>
              Full quality models ready
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>
            Higher quality STT and translation models have finished downloading. Upgrade for better accuracy.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleUpgradeToTier2}
              disabled={disabled}
              style={{
                ...buttonBaseStyle,
                background: '#22c55e',
                color: '#fff'
              }}
            >
              Upgrade to full quality
            </button>
            <button
              onClick={handleDismiss}
              style={{
                ...buttonBaseStyle,
                background: '#334155',
                color: '#94a3b8'
              }}
            >
              Keep current
            </button>
          </div>
        </div>
      )
    }

    // User hasn't switched yet but all models are ready
    return (
      <div style={bannerStyle} role="status" aria-live="polite">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
          <span style={tierBadgeStyle(true)}>Tier 2</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#4ade80' }}>
            Full quality offline models ready
          </span>
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>
          All models downloaded. Switch to offline translation for the best quality.
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            onClick={handleUpgradeToTier2}
            disabled={disabled}
            style={{
              ...buttonBaseStyle,
              background: '#22c55e',
              color: '#fff'
            }}
          >
            Switch to full quality
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

  // Tier 1 ready, Tier 2 downloading — show basic mode active + upgrade progress
  if (tier1Ready && !tier2Ready) {
    if (status === 'downloading-tier2') {
      return (
        <div style={bannerStyle} role="status" aria-live="polite">
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
            <span style={tierBadgeStyle(true)}>Tier 1</span>
            <span style={tierBadgeStyle(false)}>Tier 2</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#60a5fa' }}>
              {switchedToLocal ? 'Basic mode active' : 'Basic offline ready'}
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
            {switchedToLocal
              ? 'Translating with fast models. Downloading full quality models in background...'
              : 'Basic offline models ready. Full quality models downloading in background...'}
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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '11px', color: '#94a3b8' }}>
              Upgrading: {progress}%
            </span>
            {!switchedToLocal && (
              <button
                onClick={handleSwitchToTier1}
                disabled={disabled}
                style={{
                  ...buttonBaseStyle,
                  padding: '4px 12px',
                  background: '#22c55e',
                  color: '#fff'
                }}
              >
                Use basic offline now
              </button>
            )}
          </div>
        </div>
      )
    }

    // Tier 1 ready, Tier 2 not started or failed — prompt to use Tier 1
    if (!switchedToLocal) {
      return (
        <div style={bannerStyle} role="status" aria-live="polite">
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '6px' }}>
            <span style={tierBadgeStyle(true)}>Tier 1</span>
            <span style={{ fontSize: '13px', fontWeight: 600, color: '#4ade80' }}>
              Basic offline models ready
            </span>
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>
            Fast STT and translation models are ready. Switch now for instant offline translation, or wait for full quality models.
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleSwitchToTier1}
              disabled={disabled}
              style={{
                ...buttonBaseStyle,
                background: '#22c55e',
                color: '#fff'
              }}
            >
              Switch to basic offline
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

    // Switched to Tier 1 but Tier 2 download hasn't started/failed
    return null
  }

  // Download failed
  if (status === 'failed') {
    return (
      <div style={bannerStyle} role="alert">
        <div style={{ fontSize: '13px', fontWeight: 600, color: '#f87171', marginBottom: '6px' }}>
          Model download failed
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '10px' }}>
          Failed to download offline models. You can retry or continue with cloud translation.
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

  // Downloading Tier 1
  if (status === 'downloading-tier1' || (downloading && !tier1Ready)) {
    return (
      <div style={bannerStyle} role="status" aria-live="polite">
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: '4px' }}>
          <span style={tierBadgeStyle(false)}>Tier 1</span>
          <span style={{ fontSize: '13px', fontWeight: 600, color: '#60a5fa' }}>
            Downloading fast-start models...
          </span>
        </div>
        <div style={{ fontSize: '12px', color: '#94a3b8' }}>
          Small models (~371MB) for instant offline translation. Cloud translation works while downloading.
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
        Download fast-start models (~371MB) for instant offline translation.
        Full quality models download automatically in background.
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
