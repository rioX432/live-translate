import React from 'react'
import { Section } from './Section'
import { selectStyle } from './shared'
import type { UseAudioCaptureReturn, AudioSource } from '../../hooks/useAudioCapture'

/** Audio source display labels */
const AUDIO_SOURCE_OPTIONS: Array<{ value: AudioSource; label: string; description: string }> = [
  { value: 'microphone', label: 'Microphone', description: 'Capture from microphone only' },
  { value: 'system', label: 'System Audio', description: 'Capture system audio (Zoom, YouTube, etc.)' },
  { value: 'both', label: 'Microphone + System', description: 'Mix microphone and system audio' }
]

interface AudioSettingsProps {
  audio: UseAudioCaptureReturn
  disabled: boolean
  /** #313: Noise suppression enabled state */
  noiseSuppressionEnabled: boolean
  onNoiseSuppressionChange: (enabled: boolean) => void
  /** macOS requires Screen Recording permission for system audio (#501) */
  platform: string
}

export function AudioSettings({ audio, disabled, noiseSuppressionEnabled, onNoiseSuppressionChange, platform }: AudioSettingsProps): React.JSX.Element {
  const showMicSelector = audio.audioSource !== 'system'

  return (
    <Section label="Audio Input">
      {/* #501: Audio source selector */}
      <select
        value={audio.audioSource}
        onChange={(e) => audio.setAudioSource(e.target.value as AudioSource)}
        style={{ ...selectStyle, marginBottom: '8px' }}
        disabled={disabled}
        aria-label="Audio source"
      >
        {AUDIO_SOURCE_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {/* Description for selected audio source */}
      <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '8px' }}>
        {AUDIO_SOURCE_OPTIONS.find((o) => o.value === audio.audioSource)?.description}
        {audio.audioSource !== 'microphone' && platform === 'darwin' && (
          <span style={{ color: '#f59e0b' }}>
            {' '}— Requires Screen Recording permission
          </span>
        )}
        {audio.audioSource !== 'microphone' && platform === 'win32' && (
          <span style={{ color: '#94a3b8' }}>
            {' '}— Uses WASAPI loopback (no extra setup needed)
          </span>
        )}
      </div>
      {/* Microphone device selector — hidden when system-only mode */}
      {showMicSelector && (
        <select
          value={audio.selectedDevice}
          onChange={(e) => audio.setSelectedDevice(e.target.value)}
          style={selectStyle}
          disabled={disabled}
          aria-label="Microphone device"
        >
          {audio.devices.length === 0 ? (
            <option value="" disabled>
              No audio devices found
            </option>
          ) : (
            audio.devices.map((d) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label}
              </option>
            ))
          )}
        </select>
      )}
      {/* Volume meter */}
      <div style={{ marginTop: '6px', height: '4px', background: '#1e293b', borderRadius: '2px' }}>
        <div
          role="progressbar"
          aria-label="Volume level"
          aria-valuenow={Math.round(audio.volume * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{
            height: '100%',
            width: `${audio.volume * 100}%`,
            background: audio.volume > 0.7 ? '#ef4444' : '#22c55e',
            borderRadius: '2px',
            transition: 'width 0.1s'
          }}
        />
      </div>
      {/* #313: Noise suppression toggle — only relevant when microphone is active */}
      {showMicSelector && (
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
      )}
      {audio.permissionError && (
        <div style={{ marginTop: '6px', fontSize: '12px', color: '#ef4444' }}>
          {audio.permissionError}
        </div>
      )}
    </Section>
  )
}
