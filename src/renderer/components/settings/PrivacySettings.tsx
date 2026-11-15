import React, { useEffect, useState } from 'react'
import { Section } from './Section'
import { radioLabelStyle } from './shared'

interface PrivacySettingsProps {
  disabled: boolean
}

/**
 * Opt-in persistence controls. Meeting audio and text can be confidential, so nothing is
 * written to disk unless the user turns these on. Both take effect from the next session.
 */
export function PrivacySettings({ disabled }: PrivacySettingsProps): React.JSX.Element {
  const [saveTranscripts, setSaveTranscripts] = useState(false)
  const [sessionRecoveryEnabled, setSessionRecoveryEnabled] = useState(false)

  useEffect(() => {
    window.api
      .getSettings()
      .then((settings) => {
        const s = settings as { saveTranscripts?: boolean; sessionRecoveryEnabled?: boolean }
        setSaveTranscripts(s.saveTranscripts === true)
        setSessionRecoveryEnabled(s.sessionRecoveryEnabled === true)
      })
      .catch((err: unknown) => {
        console.warn('[privacy] Failed to load settings:', err instanceof Error ? err.message : String(err))
      })
  }, [])

  return (
    <Section label="Privacy" helpText="Nothing is saved to disk unless you enable it here. Changes apply from the next session.">
      <label style={radioLabelStyle}>
        <input
          type="checkbox"
          checked={saveTranscripts}
          disabled={disabled}
          onChange={(e) => {
            setSaveTranscripts(e.target.checked)
            window.api.saveSettings({ saveTranscripts: e.target.checked })
          }}
        />
        <div>
          <div style={{ fontWeight: 500 }}>Save transcripts to a file</div>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
            Off by default. When on, recognized and translated text is written in plain text to the app&apos;s logs folder.
          </div>
        </div>
      </label>
      <label style={radioLabelStyle}>
        <input
          type="checkbox"
          checked={sessionRecoveryEnabled}
          disabled={disabled}
          onChange={(e) => {
            setSessionRecoveryEnabled(e.target.checked)
            window.api.saveSettings({ sessionRecoveryEnabled: e.target.checked })
          }}
        />
        <div>
          <div style={{ fontWeight: 500 }}>Offer to resume after a crash</div>
          <div style={{ fontSize: '12px', color: '#94a3b8' }}>
            Off by default. Stores the engine configuration (no audio or text) of the running session.
          </div>
        </div>
      </label>
    </Section>
  )
}
