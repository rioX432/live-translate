import React, { useCallback, useEffect, useState } from 'react'
import {
  AZURE_FREE_TIER_CHARS,
  AZURE_TRANSLATOR_PORTAL_URL,
  TIER1_TOTAL_MB,
  TIER2_TOTAL_MB,
  formatSize,
  isAzureKeyValid,
  nextStep,
  pickInitialStep,
  type DownloadStatus,
  type OnboardingStep
} from './onboarding-steps'

interface OnboardingProps {
  /** Called once when the user finishes (or skips through) all three steps. */
  onComplete: () => void
}

interface DownloadState {
  status: DownloadStatus
  progress: number
  tier1Ready: boolean
  tier2Ready: boolean
  error?: string
}

/**
 * Three-step first-run onboarding (#708):
 *  1. Quick Start         — Tier 1 (Whisper Base + LFM2 350M, ~371MB)
 *                           "Ready to translate in moments"
 *  2. Quality Upgrade     — Tier 2 (Kotoba Whisper + HY-MT1.5 1.8B, ~1.6GB)
 *                           Downloads in background; auto-switches when ready
 *  3. Cloud Boost (opt.)  — Azure Translator F0 key for 2M chars/month free
 *
 * Every step is skippable. Step 3 is fully optional and can be configured
 * later in Translator Settings.
 */
export function Onboarding({ onComplete }: OnboardingProps): React.JSX.Element | null {
  const [step, setStep] = useState<OnboardingStep | null>(null)
  const [download, setDownload] = useState<DownloadState>({
    status: 'idle',
    progress: 0,
    tier1Ready: false,
    tier2Ready: false
  })
  const [azureKey, setAzureKey] = useState('')
  const [azureRegion, setAzureRegion] = useState('')
  const [azureSaving, setAzureSaving] = useState(false)
  const [azureSaveError, setAzureSaveError] = useState<string | null>(null)
  const [startError, setStartError] = useState<string | null>(null)

  // Bootstrap: load current onboarding status + any persisted Azure credentials
  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.api.onboardingGetStatus(),
      window.api.getSettings()
    ])
      .then(([status, settings]) => {
        if (cancelled) return
        const s = status as unknown as DownloadState
        setDownload({
          status: s.status,
          progress: s.progress ?? 0,
          tier1Ready: !!s.tier1Ready,
          tier2Ready: !!s.tier2Ready
        })
        setAzureKey((settings as { microsoftApiKey?: string }).microsoftApiKey ?? '')
        setAzureRegion((settings as { microsoftRegion?: string }).microsoftRegion ?? '')
        setStep(
          pickInitialStep({
            tier1Ready: !!s.tier1Ready,
            tier2Ready: !!s.tier2Ready,
            status: s.status
          })
        )
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        console.warn('[onboarding] Failed to load initial state:', message)
        if (!cancelled) setStep('quick-start')
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Subscribe to live download progress so each step reflects current state
  useEffect(() => {
    const unsub = window.api.onOnboardingDownloadProgress((data) => {
      setDownload((prev) => ({
        status: (data.status as DownloadStatus) ?? prev.status,
        progress: data.progress ?? prev.progress,
        tier1Ready: data.tier1Ready ?? prev.tier1Ready,
        tier2Ready: data.tier2Ready ?? prev.tier2Ready,
        error: data.error
      }))
    })
    return () => {
      unsub()
    }
  }, [])

  const advance = useCallback((from: OnboardingStep) => {
    const target = nextStep(from)
    if (target === 'done') {
      window.api.quickStartSkip().catch(() => {
        // best-effort: don't block completion
      })
      onComplete()
    } else {
      setStep(target)
    }
  }, [onComplete])

  const handleStartTier1 = useCallback(async () => {
    setStartError(null)
    try {
      // Triggers Tier 1 download, then Tier 2 in background automatically
      await window.api.onboardingStartDownload()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setStartError(message)
    }
  }, [])

  const handleSwitchToTier1Now = useCallback(async () => {
    try {
      await window.api.onboardingSwitchToLocal()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.warn('[onboarding] Failed to activate Tier 1 engine:', message)
    }
  }, [])

  const handleSaveAzureKey = useCallback(async () => {
    if (!isAzureKeyValid(azureKey, azureRegion)) {
      setAzureSaveError('Both API key and region are required.')
      return
    }
    setAzureSaving(true)
    setAzureSaveError(null)
    try {
      await window.api.saveSettings({
        microsoftApiKey: azureKey.trim(),
        microsoftRegion: azureRegion.trim()
      })
      advance('cloud-boost')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setAzureSaveError(`Failed to save Azure credentials: ${message}`)
    } finally {
      setAzureSaving(false)
    }
  }, [azureKey, azureRegion, advance])

  // Still loading initial state — render placeholder to avoid flicker
  if (!step) {
    return <div style={shellStyle} aria-busy="true" />
  }

  return (
    <div style={shellStyle}>
      <header style={headerStyle}>
        <h2 style={titleStyle}>Welcome to live-translate</h2>
        <p style={subtitleStyle}>
          Three quick steps to set up local-first translation. Skip anything you do not need.
        </p>
        <StepIndicator current={step} />
      </header>

      {step === 'quick-start' && (
        <StepCard
          number={1}
          title="Quick Start"
          subtitle={`Whisper Base + LFM2 350M (${formatSize(TIER1_TOTAL_MB)})`}
          description="Smallest viable speech-to-text and translation models for an instant offline start. Ready to translate in moments after download."
          status={download.status}
          progress={download.progress}
          isDownloading={download.status === 'downloading-tier1'}
          isReady={download.tier1Ready}
          error={startError ?? download.error}
        >
          {!download.tier1Ready && download.status !== 'downloading-tier1' && (
            <PrimaryButton onClick={handleStartTier1}>
              Download & start ({formatSize(TIER1_TOTAL_MB)})
            </PrimaryButton>
          )}
          {download.status === 'downloading-tier1' && (
            <p style={hintStyle}>
              Downloading… {download.progress}% complete. You can continue to the next step.
            </p>
          )}
          {download.tier1Ready && (
            <>
              <p style={readyStyle}>Ready — translation can start immediately.</p>
              <PrimaryButton onClick={handleSwitchToTier1Now}>
                Use Quick Start now
              </PrimaryButton>
            </>
          )}
          <SkipButton onClick={() => advance('quick-start')}>
            {download.tier1Ready ? 'Next: Quality upgrade' : 'Skip — continue'}
          </SkipButton>
        </StepCard>
      )}

      {step === 'quality-upgrade' && (
        <StepCard
          number={2}
          title="Quality Upgrade"
          subtitle={`Kotoba Whisper + HY-MT1.5 1.8B (${formatSize(TIER2_TOTAL_MB)})`}
          description="Higher-accuracy Japanese-optimized speech-to-text and translation. Downloads in the background — live-translate switches to high-quality mode automatically when ready."
          status={download.status}
          progress={download.progress}
          isDownloading={download.status === 'downloading-tier2'}
          isReady={download.tier2Ready}
          error={download.error}
        >
          {download.tier2Ready && (
            <p style={readyStyle}>
              Full-quality models ready. live-translate will use them on the next session.
            </p>
          )}
          {download.status === 'downloading-tier2' && !download.tier2Ready && (
            <p style={hintStyle}>
              Downloading in background… {download.progress}% complete. Translation keeps working with Quick Start.
            </p>
          )}
          {!download.tier2Ready && download.status !== 'downloading-tier2' && (
            <p style={hintStyle}>
              Background download will start once Quick Start finishes. No action needed.
            </p>
          )}
          <SkipButton onClick={() => advance('quality-upgrade')}>
            Next: Optional cloud boost
          </SkipButton>
        </StepCard>
      )}

      {step === 'cloud-boost' && (
        <StepCard
          number={3}
          title="Cloud Boost (Optional)"
          subtitle={`Azure Translator free tier — ${AZURE_FREE_TIER_CHARS}`}
          description="You're already translating offline. Adding a free Azure F0 key adds optional cloud-quality fallback for harder phrases. You can do this later in Translator Settings."
        >
          <ol style={instructionListStyle}>
            <li>
              Open the Azure portal: <a href={AZURE_TRANSLATOR_PORTAL_URL} target="_blank" rel="noreferrer noopener" style={linkStyle}>
                Create Translator (F0 free tier)
              </a>
            </li>
            <li>Select pricing tier <strong>F0</strong> ({AZURE_FREE_TIER_CHARS}, no card required).</li>
            <li>Copy <strong>Key 1</strong> and the <strong>Region</strong> from Keys and Endpoint.</li>
            <li>Paste them below and save — about 5 minutes total.</li>
          </ol>

          <label style={fieldLabelStyle} htmlFor="onboarding-azure-key">Azure Translator key</label>
          <input
            id="onboarding-azure-key"
            type="password"
            value={azureKey}
            onChange={(e) => setAzureKey(e.target.value)}
            placeholder="Paste Key 1 from the Azure portal"
            aria-label="Azure Translator key"
            style={inputStyle}
            disabled={azureSaving}
          />

          <label style={fieldLabelStyle} htmlFor="onboarding-azure-region">Azure region</label>
          <input
            id="onboarding-azure-region"
            type="text"
            value={azureRegion}
            onChange={(e) => setAzureRegion(e.target.value)}
            placeholder="e.g. eastus, japaneast"
            aria-label="Azure region"
            style={inputStyle}
            disabled={azureSaving}
          />

          {azureSaveError && (
            <div role="alert" style={errorStyle}>{azureSaveError}</div>
          )}

          <PrimaryButton
            onClick={handleSaveAzureKey}
            disabled={azureSaving || !isAzureKeyValid(azureKey, azureRegion)}
          >
            {azureSaving ? 'Saving…' : 'Save Azure key & finish'}
          </PrimaryButton>
          <SkipButton onClick={() => advance('cloud-boost')}>
            Skip — works great offline
          </SkipButton>
        </StepCard>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

function StepIndicator({ current }: { current: OnboardingStep }): React.JSX.Element {
  const steps: { id: OnboardingStep; label: string }[] = [
    { id: 'quick-start', label: '1. Quick Start' },
    { id: 'quality-upgrade', label: '2. Quality' },
    { id: 'cloud-boost', label: '3. Cloud (Optional)' }
  ]
  return (
    <nav aria-label="Onboarding progress" style={indicatorWrapStyle}>
      {steps.map((s) => {
        const active = s.id === current
        return (
          <span
            key={s.id}
            style={{
              ...indicatorPillStyle,
              background: active ? '#1e3a8a' : '#1e293b',
              color: active ? '#bfdbfe' : '#94a3b8',
              borderColor: active ? '#3b82f6' : '#334155'
            }}
            aria-current={active ? 'step' : undefined}
          >
            {s.label}
          </span>
        )
      })}
    </nav>
  )
}

interface StepCardProps {
  number: number
  title: string
  subtitle: string
  description: string
  status?: DownloadStatus
  progress?: number
  isDownloading?: boolean
  isReady?: boolean
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

const indicatorWrapStyle: React.CSSProperties = {
  display: 'flex',
  gap: '8px',
  flexWrap: 'wrap'
}

const indicatorPillStyle: React.CSSProperties = {
  display: 'inline-block',
  padding: '4px 10px',
  fontSize: '11px',
  fontWeight: 600,
  borderRadius: '999px',
  border: '1px solid #334155'
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

const instructionListStyle: React.CSSProperties = {
  margin: '0 0 14px 0',
  paddingLeft: '20px',
  fontSize: '12px',
  color: '#cbd5f5',
  lineHeight: 1.6
}

const linkStyle: React.CSSProperties = {
  color: '#60a5fa',
  textDecoration: 'underline'
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  color: '#94a3b8',
  marginTop: '8px',
  marginBottom: '4px'
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: '13px',
  background: '#0f172a',
  color: '#e2e8f0',
  border: '1px solid #334155',
  borderRadius: '6px',
  fontFamily: 'monospace'
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
