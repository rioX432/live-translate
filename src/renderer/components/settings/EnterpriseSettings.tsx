import React, { useEffect, useState } from 'react'
import { Section } from './Section'
import { selectStyle } from './shared'

interface MdmConfig {
  lockedEngine: string | null
  lockedSttEngine: string | null
  telemetryDisabled: boolean
  hasManagedApiKey: boolean
  hasManagedDeeplApiKey: boolean
  hasManagedGeminiApiKey: boolean
  organizationName: string | null
  autoUpdateDisabled: boolean
}

interface UsageSummary {
  totalSessions: number
  totalDurationMs: number
  totalCharacters: number
  averageSessionDurationMs: number
  engineBreakdown: Record<string, number>
}

interface TelemetryState {
  consent: boolean
  consentShown: boolean
  mdmDisabled: boolean
}

interface Props {
  disabled: boolean
}

function formatDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`
  const h = Math.floor(ms / 3600000)
  const m = Math.round((ms % 3600000) / 60000)
  return `${h}h ${m}m`
}

export function EnterpriseSettings({ disabled }: Props): React.JSX.Element {
  const [mdmConfig, setMdmConfig] = useState<MdmConfig | null>(null)
  const [usage, setUsage] = useState<UsageSummary | null>(null)
  const [telemetry, setTelemetry] = useState<TelemetryState | null>(null)
  const [usagePeriod, setUsagePeriod] = useState(30)

  useEffect(() => {
    window.api.enterpriseGetMdmConfig().then(setMdmConfig).catch((err) => console.warn('Failed to load MDM config:', err))
    window.api.enterpriseGetTelemetryConsent().then(setTelemetry).catch((err) => console.warn('Failed to load telemetry consent:', err))
  }, [])

  useEffect(() => {
    window.api.enterpriseGetUsageSummary(usagePeriod).then((data) => {
      if (!('error' in data)) setUsage(data)
    }).catch((err) => console.warn('Failed to load usage summary:', err))
  }, [usagePeriod])

  const handleTelemetryToggle = async (): Promise<void> => {
    if (!telemetry || telemetry.mdmDisabled) return
    const newConsent = !telemetry.consent
    const result = await window.api.enterpriseSetTelemetryConsent(newConsent)
    if (result.success) {
      setTelemetry({ ...telemetry, consent: newConsent, consentShown: true })
    }
  }

  return (
    <>
      {/* MDM / Organization info */}
      {mdmConfig?.organizationName && (
        <Section label="Organization">
          <div style={infoBoxStyle}>
            <span style={orgNameStyle}>{mdmConfig.organizationName}</span>
            <span style={managedBadgeStyle}>Managed</span>
          </div>
          {mdmConfig.lockedEngine && (
            <div style={infoLineStyle}>
              Translation engine locked to: <strong>{mdmConfig.lockedEngine}</strong>
            </div>
          )}
          {mdmConfig.lockedSttEngine && (
            <div style={infoLineStyle}>
              STT engine locked to: <strong>{mdmConfig.lockedSttEngine}</strong>
            </div>
          )}
          {mdmConfig.hasManagedApiKey && (
            <div style={infoLineStyle}>Google API key provided by organization</div>
          )}
          {mdmConfig.hasManagedDeeplApiKey && (
            <div style={infoLineStyle}>DeepL API key provided by organization</div>
          )}
          {mdmConfig.hasManagedGeminiApiKey && (
            <div style={infoLineStyle}>Gemini API key provided by organization</div>
          )}
          {mdmConfig.autoUpdateDisabled && (
            <div style={infoLineStyle}>Auto-updates managed by organization</div>
          )}
        </Section>
      )}

      {/* Usage Analytics */}
      <Section label="Usage Analytics">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
          <label style={{ fontSize: '12px', color: '#94a3b8' }}>Period:</label>
          <select
            style={{ ...selectStyle, width: 'auto', padding: '4px 8px', fontSize: '12px' }}
            value={usagePeriod}
            onChange={(e) => setUsagePeriod(Number(e.target.value))}
            disabled={disabled}
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
        </div>

        {usage ? (
          <div style={statsGridStyle}>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{usage.totalSessions}</div>
              <div style={statLabelStyle}>Sessions</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{formatDuration(usage.totalDurationMs)}</div>
              <div style={statLabelStyle}>Total Time</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{usage.totalCharacters.toLocaleString()}</div>
              <div style={statLabelStyle}>Characters</div>
            </div>
            <div style={statCardStyle}>
              <div style={statValueStyle}>{formatDuration(usage.averageSessionDurationMs)}</div>
              <div style={statLabelStyle}>Avg Session</div>
            </div>
          </div>
        ) : (
          <div style={{ fontSize: '12px', color: '#64748b' }}>Loading usage data...</div>
        )}

        {usage && Object.keys(usage.engineBreakdown).length > 0 && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ fontSize: '11px', color: '#64748b', marginBottom: '4px' }}>Engine Usage</div>
            {Object.entries(usage.engineBreakdown)
              .sort(([, a], [, b]) => b - a)
              .map(([engine, count]) => (
                <div key={engine} style={engineBarStyle}>
                  <span style={{ fontSize: '12px', color: '#94a3b8', minWidth: '120px' }}>{engine}</span>
                  <div style={barContainerStyle}>
                    <div style={{
                      ...barFillStyle,
                      width: `${Math.round((count / usage.totalSessions) * 100)}%`
                    }} />
                  </div>
                  <span style={{ fontSize: '11px', color: '#64748b', minWidth: '30px', textAlign: 'right' }}>{count}</span>
                </div>
              ))}
          </div>
        )}
      </Section>

      {/* Telemetry Consent */}
      <Section label="Telemetry">
        <label style={checkboxLabelStyle}>
          <input
            type="checkbox"
            checked={telemetry?.consent ?? false}
            onChange={handleTelemetryToggle}
            disabled={disabled || telemetry?.mdmDisabled === true}
          />
          <span>Send anonymous usage statistics to help improve the app</span>
        </label>
        {telemetry?.mdmDisabled && (
          <div style={mdmNoticeStyle}>
            Telemetry is disabled by your organization's policy.
          </div>
        )}
        <div style={telemetryInfoStyle}>
          Data collected (when enabled): session count, duration, engine type, language pairs.
          No audio, text content, or personal information is ever collected.
        </div>
      </Section>
    </>
  )
}

const infoBoxStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '8px 12px',
  background: '#1e293b',
  borderRadius: '6px',
  marginBottom: '6px'
}

const orgNameStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: '#e2e8f0'
}

const managedBadgeStyle: React.CSSProperties = {
  fontSize: '10px',
  fontWeight: 600,
  color: '#3b82f6',
  background: '#1e3a5f',
  padding: '2px 6px',
  borderRadius: '4px',
  textTransform: 'uppercase',
  letterSpacing: '0.05em'
}

const infoLineStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#94a3b8',
  padding: '2px 12px'
}

const statsGridStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, 1fr)',
  gap: '8px'
}

const statCardStyle: React.CSSProperties = {
  padding: '10px',
  background: '#1e293b',
  borderRadius: '6px',
  textAlign: 'center'
}

const statValueStyle: React.CSSProperties = {
  fontSize: '18px',
  fontWeight: 700,
  color: '#e2e8f0'
}

const statLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#64748b',
  marginTop: '2px'
}

const engineBarStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  padding: '3px 0'
}

const barContainerStyle: React.CSSProperties = {
  flex: 1,
  height: '6px',
  background: '#1e293b',
  borderRadius: '3px',
  overflow: 'hidden'
}

const barFillStyle: React.CSSProperties = {
  height: '100%',
  background: '#3b82f6',
  borderRadius: '3px',
  transition: 'width 0.3s ease'
}

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  fontSize: '13px',
  color: '#e2e8f0',
  cursor: 'pointer',
  padding: '4px 0'
}

const mdmNoticeStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#f59e0b',
  padding: '4px 0',
  fontStyle: 'italic'
}

const telemetryInfoStyle: React.CSSProperties = {
  fontSize: '11px',
  color: '#64748b',
  marginTop: '6px',
  lineHeight: '1.4'
}
