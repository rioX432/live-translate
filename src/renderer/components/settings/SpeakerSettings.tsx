import React from 'react'
import { Section } from './Section'

interface SpeakerSettingsProps {
  speakerDiarizationEnabled: boolean
  onSpeakerDiarizationEnabledChange: (v: boolean) => void
  platform: string
  disabled: boolean
}

/**
 * Speaker diarization settings panel (#549).
 * Experimental: requires FluidAudio CLI bridge (macOS only).
 */
export function SpeakerSettings({
  speakerDiarizationEnabled,
  onSpeakerDiarizationEnabledChange,
  platform,
  disabled
}: SpeakerSettingsProps): React.JSX.Element | null {
  // Only show on macOS — FluidAudio is CoreML-native
  if (platform !== 'darwin') return null

  return (
    <Section label="Speaker Diarization">
      <label style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '13px',
        color: '#e2e8f0',
        cursor: 'pointer'
      }}>
        <input
          type="checkbox"
          checked={speakerDiarizationEnabled}
          onChange={(e) => onSpeakerDiarizationEnabledChange(e.target.checked)}
          disabled={disabled}
          style={{ width: '16px', height: '16px' }}
        />
        Enable speaker identification
      </label>
      <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
        Identifies speakers via FluidAudio (CoreML). Color-coded labels appear on subtitles.
        ~32MB models, ~40μs/chunk on Apple Silicon.
      </div>
      {speakerDiarizationEnabled && (
        <div style={{ marginTop: '6px', fontSize: '11px', color: '#f59e0b' }}>
          Requires{' '}
          <span style={{ fontFamily: 'monospace', fontSize: '10px' }}>fluid-audio-bridge</span>
          {' '}CLI (
          <span style={{ fontFamily: 'monospace', fontSize: '10px' }}>
            cd scripts/fluid-audio &amp;&amp; swift build -c release &amp;&amp; cp .build/release/fluid-audio-bridge /opt/homebrew/bin/
          </span>
          ).
        </div>
      )}
    </Section>
  )
}
