import React, { useEffect, useState } from 'react'
import {
  LANGUAGE_LABELS,
  selectStyle,
  buttonStyle
} from './shared'
import type { Language, SourceLanguage } from './shared'

interface QuickStartPanelProps {
  onSetupComplete: () => void
}

interface Recommendation {
  sttEngine: string
  translationEngine: string
  whisperVariant: string
  downloads: Array<{ type: string; filename: string; url: string; sizeMB: number; label: string }>
  totalDownloadMB: number
  needsDownload: boolean
  fallbackEngine: string | null
  reason: string
}

interface SystemInfo {
  platform: string
  totalMemoryMB: number
  gpuInfo: { hasGpu: boolean; gpuNames: string[] }
}

type SetupPhase = 'loading' | 'ready' | 'applying' | 'done'

export function QuickStartPanel({ onSetupComplete }: QuickStartPanelProps): React.JSX.Element {
  const [phase, setPhase] = useState<SetupPhase>('loading')
  const [recommendation, setRecommendation] = useState<Recommendation | null>(null)
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null)
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>('auto')
  const [targetLanguage, setTargetLanguage] = useState<Language>('en')
  const [error, setError] = useState<string | null>(null)

  // Load hardware recommendation on mount
  useEffect(() => {
    Promise.all([
      window.api.quickStartRecommend(),
      window.api.quickStartSystemInfo()
    ]).then(([rec, info]) => {
      setRecommendation(rec)
      setSystemInfo(info)
      setPhase('ready')
    }).catch((err) => {
      setError(`Failed to detect hardware: ${err instanceof Error ? err.message : String(err)}`)
      setPhase('ready')
    })
  }, [])

  const handleStart = async (): Promise<void> => {
    if (!recommendation) return
    setPhase('applying')
    try {
      await window.api.quickStartApply({
        sourceLanguage,
        targetLanguage,
        recommendation
      })
      setPhase('done')
      onSetupComplete()
    } catch (err) {
      setError(`Setup failed: ${err instanceof Error ? err.message : String(err)}`)
      setPhase('ready')
    }
  }

  const handleSkip = async (): Promise<void> => {
    await window.api.quickStartSkip()
    onSetupComplete()
  }

  if (phase === 'loading') {
    return (
      <div style={panelStyle}>
        <div style={headerStyle}>
          <h2 style={titleStyle}>Quick Start</h2>
          <p style={subtitleStyle}>Detecting your hardware...</p>
        </div>
        <div style={spinnerContainerStyle}>
          <div style={spinnerStyle} />
        </div>
      </div>
    )
  }

  return (
    <div style={panelStyle}>
      <div style={headerStyle}>
        <h2 style={titleStyle}>Quick Start</h2>
        <p style={subtitleStyle}>
          Set up live translation in one click. We've detected your hardware and selected the best engines.
        </p>
      </div>

      {error && (
        <div style={errorStyle}>{error}</div>
      )}

      {/* Hardware info */}
      {systemInfo && (
        <div style={infoCardStyle}>
          <div style={infoRowStyle}>
            <span style={infoLabelStyle}>Platform</span>
            <span style={infoValueStyle}>
              {systemInfo.platform === 'darwin' ? 'macOS' : systemInfo.platform === 'win32' ? 'Windows' : systemInfo.platform}
            </span>
          </div>
          <div style={infoRowStyle}>
            <span style={infoLabelStyle}>Memory</span>
            <span style={infoValueStyle}>{Math.round(systemInfo.totalMemoryMB / 1024)}GB</span>
          </div>
          <div style={infoRowStyle}>
            <span style={infoLabelStyle}>GPU</span>
            <span style={{ color: systemInfo.gpuInfo.hasGpu ? '#22c55e' : '#f59e0b', fontSize: '12px' }}>
              {systemInfo.gpuInfo.hasGpu ? systemInfo.gpuInfo.gpuNames.join(', ') : 'Not detected'}
            </span>
          </div>
        </div>
      )}

      {/* Recommendation */}
      {recommendation && (
        <div style={infoCardStyle}>
          <div style={{ fontSize: '11px', color: '#64748b', textTransform: 'uppercase' as const, letterSpacing: '0.05em', marginBottom: '8px', fontWeight: 600 }}>
            Recommended Configuration
          </div>
          <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px', lineHeight: '1.5' }}>
            {recommendation.reason}
          </div>
          {recommendation.needsDownload && (
            <div style={downloadInfoStyle}>
              <span style={{ fontSize: '12px' }}>
                {recommendation.downloads.length} model{recommendation.downloads.length > 1 ? 's' : ''} to download
              </span>
              <span style={{ fontSize: '12px', fontWeight: 600 }}>
                {recommendation.totalDownloadMB >= 1024
                  ? `${(recommendation.totalDownloadMB / 1024).toFixed(1)}GB`
                  : `${recommendation.totalDownloadMB}MB`
                }
              </span>
            </div>
          )}
          {recommendation.needsDownload && recommendation.fallbackEngine && (
            <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>
              Translation will start immediately using a lightweight fallback while models download.
            </div>
          )}
        </div>
      )}

      {/* Language selection */}
      <div style={{ marginBottom: '16px' }}>
        <div style={sectionLabelStyle}>Language</div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <div style={{ flex: 1 }}>
            <label style={fieldLabelStyle}>Source</label>
            <select
              value={sourceLanguage}
              onChange={(e) => setSourceLanguage(e.target.value as SourceLanguage)}
              style={selectStyle}
              disabled={phase === 'applying'}
            >
              <option value="auto">Auto-detect</option>
              {Object.entries(LANGUAGE_LABELS).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>
          <div style={{ flex: 0, display: 'flex', alignItems: 'flex-end', paddingBottom: '8px', color: '#64748b' }}>
            →
          </div>
          <div style={{ flex: 1 }}>
            <label style={fieldLabelStyle}>Target</label>
            <select
              value={targetLanguage}
              onChange={(e) => setTargetLanguage(e.target.value as Language)}
              style={selectStyle}
              disabled={phase === 'applying'}
            >
              {Object.entries(LANGUAGE_LABELS).map(([code, label]) => (
                <option key={code} value={code}>{label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Action buttons */}
      <button
        onClick={handleStart}
        disabled={phase === 'applying' || !recommendation}
        style={{
          ...buttonStyle,
          background: phase === 'applying' ? '#334155' : '#3b82f6',
          opacity: phase === 'applying' ? 0.7 : 1
        }}
      >
        {phase === 'applying' ? 'Setting up...' : 'Start Translating'}
      </button>

      <button
        onClick={handleSkip}
        disabled={phase === 'applying'}
        style={skipButtonStyle}
      >
        Skip — I'll configure manually
      </button>
    </div>
  )
}

// --- Styles ---

const panelStyle: React.CSSProperties = {
  padding: '20px',
  marginBottom: '16px'
}

const headerStyle: React.CSSProperties = {
  marginBottom: '20px'
}

const titleStyle: React.CSSProperties = {
  fontSize: '20px',
  fontWeight: 700,
  color: '#f8fafc',
  marginBottom: '6px',
  letterSpacing: '-0.02em'
}

const subtitleStyle: React.CSSProperties = {
  fontSize: '13px',
  color: '#94a3b8',
  lineHeight: '1.5'
}

const infoCardStyle: React.CSSProperties = {
  background: '#1e293b',
  borderRadius: '8px',
  padding: '12px 14px',
  marginBottom: '16px'
}

const infoRowStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '3px 0'
}

const infoLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#94a3b8'
}

const infoValueStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#e2e8f0'
}

const downloadInfoStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  background: '#0f172a',
  borderRadius: '6px',
  padding: '8px 10px',
  color: '#f59e0b'
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  fontWeight: 600,
  color: '#94a3b8',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  marginBottom: '8px'
}

const fieldLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '11px',
  color: '#64748b',
  marginBottom: '4px'
}

const skipButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '10px',
  fontSize: '13px',
  fontWeight: 500,
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  color: '#94a3b8',
  background: 'transparent',
  marginTop: '8px'
}

const spinnerContainerStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '32px 0'
}

const spinnerStyle: React.CSSProperties = {
  width: '24px',
  height: '24px',
  border: '2px solid #334155',
  borderTopColor: '#3b82f6',
  borderRadius: '50%',
  animation: 'spin 0.8s linear infinite'
}

const errorStyle: React.CSSProperties = {
  background: '#7f1d1d',
  color: '#fca5a5',
  padding: '10px 12px',
  borderRadius: '6px',
  fontSize: '12px',
  marginBottom: '16px'
}
