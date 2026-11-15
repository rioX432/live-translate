import React, { useCallback, useEffect, useState } from 'react'
import {
  formatSize,
  isDownloading,
  nextStep,
  type DownloadStatus,
  type OnboardingStep
} from './onboarding-steps'

interface OnboardingProps {
  /** Called once when the user finishes (or skips) onboarding. */
  onComplete: () => void
}

interface DownloadState {
  status: DownloadStatus
  progress: number
  ready: boolean
  label: string
  sizeMB: number
  error?: string
}

/**
 * First-run onboarding: one download of the speech and translation models main selected
 * for this platform. Skippable — the pipeline downloads missing models on start anyway.
 */
export function Onboarding({ onComplete }: OnboardingProps): React.JSX.Element | null {
  const [step, setStep] = useState<OnboardingStep | null>(null)
  const [download, setDownload] = useState<DownloadState>({
    status: 'idle',
    progress: 0,
    ready: false,
    label: '',
    sizeMB: 0
  })
  const [startError, setStartError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    window.api
      .onboardingGetStatus()
      .then((s) => {
        if (cancelled) return
        setDownload({
          status: s.status as DownloadStatus,
          progress: s.progress ?? 0,
          ready: !!s.tier1Ready,
          label: s.currentLabel,
          sizeMB: s.currentTierSizeMB
        })
        setStep('download')
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('[onboarding] Failed to load initial state:', message)
        if (!cancelled) setStep('download')
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const unsub = window.api.onOnboardingDownloadProgress((data) => {
      setDownload((prev) => ({
        ...prev,
        status: (data.status as DownloadStatus) ?? prev.status,
        progress: data.progress ?? prev.progress,
        ready: data.tier1Ready ?? prev.ready,
        error: data.error
      }))
    })
    return () => {
      unsub()
    }
  }, [])

  const advance = useCallback((from: OnboardingStep) => {
    if (nextStep(from) === 'done') {
      window.api.quickStartSkip().catch(() => {
        // best-effort: don't block completion
      })
      onComplete()
    }
  }, [onComplete])

  const handleStart = useCallback(async () => {
    setStartError(null)
    try {
      await window.api.onboardingStartDownload()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setStartError(message)
    }
  }, [])

  // Still loading initial state — render placeholder to avoid flicker
  if (!step) {
    return <div style={shellStyle} aria-busy="true" />
  }

  const downloading = isDownloading(download.status)
  const sizeLabel = download.sizeMB > 0 ? ` (${formatSize(download.sizeMB)})` : ''

  return (
    <div style={shellStyle}>
      <header style={headerStyle}>
        <h2 style={titleStyle}>Welcome to live-translate</h2>
        <p style={subtitleStyle}>
          Translation runs entirely on this computer. Download the models once to get started.
        </p>
      </header>

      <StepCard
        number={1}
        title="Download models"
        subtitle={`${download.label}${sizeLabel}`}
        description="Speech recognition and translation models chosen for this computer. After the download, translation works offline."
        progress={download.progress}
        isDownloading={downloading}
        error={startError ?? download.error}
      >
        {!download.ready && !downloading && (
          <PrimaryButton onClick={handleStart}>Download{sizeLabel}</PrimaryButton>
        )}
        {downloading && (
          <p style={hintStyle}>Downloading… {download.progress}% complete.</p>
        )}
        {download.ready && (
          <p style={readyStyle}>Ready — translation can start immediately.</p>
        )}
        <SkipButton onClick={() => advance('download')}>
          {download.ready ? 'Finish' : 'Skip for now'}
        </SkipButton>
      </StepCard>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

interface StepCardProps {
  number: number
  title: string
  subtitle: string
  description: string
  progress?: number
  isDownloading?: boolean
  error?: string
  children: React.ReactNode
}

function StepCard(props: StepCardProps): React.JSX.Element {
  const showProgress = props.isDownloading && typeof props.progress === 'number'
  return (
    <section style={cardStyle} aria-labelledby={`onboarding-step-${props.number}-title`}>
      <div style={cardHeaderStyle}>
        <span style={stepNumberStyle}>Step {props.number}</span>
        <h3 id={`onboarding-step-${props.number}-title`} style={cardTitleStyle}>{props.title}</h3>
      </div>
      <p style={cardSubtitleStyle}>{props.subtitle}</p>
      <p style={cardDescriptionStyle}>{props.description}</p>

      {showProgress && (
        <div style={progressTrackStyle} aria-hidden={false}>
          <div
            role="progressbar"
            aria-label={`${props.title} download progress`}
            aria-valuenow={props.progress}
            aria-valuemin={0}
            aria-valuemax={100}
            style={{
              ...progressFillStyle,
              width: `${Math.max(props.progress ?? 0, 2)}%`
            }}
          />
        </div>
      )}

      {props.error && (
        <div role="alert" style={errorStyle}>{props.error}</div>
      )}

      <div style={actionsStyle}>{props.children}</div>
    </section>
  )
}

function PrimaryButton({
  children,
  onClick,
  disabled
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...primaryButtonStyle,
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer'
      }}
    >
      {children}
    </button>
  )
}

function SkipButton({
  children,
  onClick
}: {
  children: React.ReactNode
  onClick: () => void
}): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} style={skipButtonStyle}>
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Styles (kept inline to match existing settings panel conventions)
// ---------------------------------------------------------------------------

const shellStyle: React.CSSProperties = {
  padding: '1.5rem',
  fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  color: '#e2e8f0',
  background: '#0f172a',
  minHeight: '100%',
  fontSize: '0.875rem'
}

const headerStyle: React.CSSProperties = {
  marginBottom: '20px'
}

const titleStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  color: '#f8fafc',
  margin: '0 0 6px 0',
  letterSpacing: '-0.02em'
}

const subtitleStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#94a3b8',
  lineHeight: 1.5,
  marginBottom: '14px'
}

const cardStyle: React.CSSProperties = {
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '10px',
  padding: '18px 20px'
}

const cardHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: '10px',
  marginBottom: '6px'
}

const stepNumberStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#60a5fa'
}

const cardTitleStyle: React.CSSProperties = {
  fontSize: '17px',
  fontWeight: 700,
  color: '#f8fafc',
  margin: 0
}

const cardSubtitleStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#cbd5f5',
  marginTop: '4px',
  marginBottom: '8px',
  fontWeight: 500
}

const cardDescriptionStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#94a3b8',
  lineHeight: 1.5,
  marginBottom: '14px'
}

const progressTrackStyle: React.CSSProperties = {
  width: '100%',
  height: '6px',
  background: '#0f172a',
  borderRadius: '3px',
  overflow: 'hidden',
  marginBottom: '12px'
}

const progressFillStyle: React.CSSProperties = {
  height: '100%',
  background: '#3b82f6',
  borderRadius: '3px',
  transition: 'width 0.3s ease'
}

const actionsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '8px'
}

const primaryButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px 14px',
  fontSize: '13px',
  fontWeight: 600,
  border: 'none',
  borderRadius: '8px',
  background: '#3b82f6',
  color: '#fff'
}

const skipButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 14px',
  fontSize: '12px',
  fontWeight: 500,
  border: '1px solid #334155',
  borderRadius: '8px',
  background: 'transparent',
  color: '#94a3b8',
  cursor: 'pointer'
}

const hintStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#94a3b8',
  margin: '0 0 4px 0'
}

const readyStyle: React.CSSProperties = {
  fontSize: '13px',
  fontWeight: 600,
  color: '#4ade80',
  margin: '0 0 6px 0'
}

const errorStyle: React.CSSProperties = {
  background: '#7f1d1d',
  color: '#fee2e2',
  padding: '8px 12px',
  borderRadius: '6px',
  fontSize: '12px',
  marginBottom: '10px'
}

export default Onboarding
