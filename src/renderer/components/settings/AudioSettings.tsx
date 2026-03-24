import React from 'react'
import { Section } from './Section'
import { selectStyle } from './shared'
import type { UseAudioCaptureReturn } from '../../hooks/useAudioCapture'

interface AudioSettingsProps {
  audio: UseAudioCaptureReturn
  disabled: boolean
  /** #313: Noise suppression enabled state */
  noiseSuppressionEnabled: boolean
  onNoiseSuppressionChange: (enabled: boolean) => void
}

export function AudioSettings({ audio, disabled, noiseSuppressionEnabled, onNoiseSuppressionChange }: AudioSettingsProps): React.JSX.Element {
  return (
    <Section label="Microphone">
      <select
        value={audio.selectedDevice}
        onChange={(e) => audio.setSelectedDevice(e.target.value)}
        style={selectStyle}
        disabled={disabled}
        aria-label="Microphone device"
      >
        {audio.devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label}
          </option>
        ))}
      </select>
      {/* Volume meter */}
      <div style={{ marginTop: '6px', height: '4px', background: '#1e293b', borderRadius: '2px' }}>
        <div
          style={{
            height: '100%',
            width: `${audio.volume * 100}%`,
            background: audio.volume > 0.7 ? '#ef4444' : '#22c55e',
            borderRadius: '2px',
            transition: 'width 0.1s'
          }}
        />
      </div>
      {/* #313: Noise suppression toggle */}
      <label style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '8px',
        fontSize: '13px',
        color: '#94a3b8',
        cursor: disabled ? 'default' : 'pointer'
      }}>
        <input
          type="checkbox"
          checked={noiseSuppressionEnabled}
          onChange={(e) => onNoiseSuppressionChange(e.target.checked)}
          disabled={disabled}
          aria-label="Enable noise suppression"
        />
        <span>Noise suppression (DeepFilterNet3)</span>
      </label>
      {audio.permissionError && (
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#ef4444' }}>
          {audio.permissionError}
        </div>
      )}
    </Section>
  )
}
