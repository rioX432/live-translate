import React, { useCallback, useEffect, useState } from 'react'
import { Section } from './Section'
import { selectStyle, sliderLabelStyle } from './shared'

interface VirtualDevice {
  id: number
  name: string
  maxOutputChannels: number
  defaultSampleRate: number
}

interface VirtualMicSettingsProps {
  disabled: boolean
}

/**
 * Virtual Microphone settings panel (#515).
 * Routes TTS audio to a virtual audio device (e.g. BlackHole) so that
 * meeting apps (Zoom, Teams, Meet) can capture the translated speech.
 */
export function VirtualMicSettings({ disabled }: VirtualMicSettingsProps): React.JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const [devices, setDevices] = useState<VirtualDevice[]>([])
  const [activeDeviceId, setActiveDeviceId] = useState<number | null>(null)
  const [activeDeviceName, setActiveDeviceName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load status on mount
  useEffect(() => {
    window.api.virtualMicGetStatus().then((status) => {
      setEnabled(status.enabled)
      setActiveDeviceId(status.activeDeviceId)
      setActiveDeviceName(status.activeDeviceName)
      setDevices(status.availableDevices)
    }).catch((err) => console.warn('Failed to get virtual mic status:', err))
  }, [])

  const refreshDevices = useCallback(() => {
    window.api.virtualMicRefreshDevices().then((devs) => {
      setDevices(devs)
    }).catch((err) => console.warn('Failed to refresh virtual mic devices:', err))
  }, [])

  const handleEnable = useCallback(async (deviceId: number) => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.virtualMicEnable(deviceId)
      if (result.error) {
        setError(result.error)
        setEnabled(false)
      } else {
        setEnabled(true)
        setActiveDeviceId(deviceId)
        const device = devices.find((d) => d.id === deviceId)
        setActiveDeviceName(device?.name ?? null)
      }
    } catch {
      setEnabled(false)
      setError('Failed to enable virtual mic')
    } finally {
      setLoading(false)
    }
  }, [devices])

  const handleDisable = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await window.api.virtualMicDisable()
      setEnabled(false)
      setActiveDeviceId(null)
      setActiveDeviceName(null)
    } catch {
      setError('Failed to disable virtual mic')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleToggle = useCallback(async (checked: boolean) => {
    if (checked) {
      // Enable with the first available device, or the previously active one
      const targetId = activeDeviceId ?? devices[0]?.id
      if (targetId == null) {
        setError('No virtual audio device found. Install BlackHole or a similar virtual audio driver.')
        return
      }
      await handleEnable(targetId)
    } else {
      await handleDisable()
    }
  }, [activeDeviceId, devices, handleEnable, handleDisable])

  const handleDeviceChange = useCallback(async (deviceIdStr: string) => {
    const deviceId = parseInt(deviceIdStr, 10)
    if (isNaN(deviceId)) return
    await handleEnable(deviceId)
  }, [handleEnable])

  const noDevices = devices.length === 0

  return (
    <Section label="Virtual Microphone (Meeting Sharing)">
      {/* Enable/disable toggle */}
      <label style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontSize: '13px',
        color: '#94a3b8',
        cursor: disabled || loading ? 'default' : 'pointer',
        marginBottom: '8px'
      }}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => handleToggle(e.target.checked)}
          disabled={disabled || loading || noDevices}
          aria-label="Enable virtual microphone output"
        />
        <span>
          {loading
            ? 'Connecting...'
            : enabled
              ? `Routing TTS to: ${activeDeviceName ?? 'virtual device'}`
              : 'Route translated speech to virtual microphone'
          }
        </span>
      </label>

      {/* Error message */}
      {error && (
        <div style={{
          fontSize: '12px',
          color: '#f87171',
          marginBottom: '8px',
          padding: '6px 8px',
          background: '#1e1215',
          borderRadius: '4px'
        }}>
          {error}
        </div>
      )}

      {/* Device selector — shown when enabled or when devices exist */}
      {enabled && devices.length > 1 && (
        <>
          <div style={sliderLabelStyle}>Virtual Audio Device</div>
          <select
            value={activeDeviceId ?? ''}
            onChange={(e) => handleDeviceChange(e.target.value)}
            style={{ ...selectStyle, marginBottom: '8px' }}
            disabled={disabled || loading}
            aria-label="Virtual audio device"
          >
            {devices.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.defaultSampleRate / 1000}kHz)
              </option>
            ))}
          </select>
        </>
      )}

      {/* Status indicator */}
      {enabled && (
        <div style={{
          fontSize: '12px',
          color: '#4ade80',
          marginBottom: '6px',
          display: 'flex',
          alignItems: 'center',
          gap: '6px'
        }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#4ade80',
            display: 'inline-block'
          }} />
          Active — select &quot;{activeDeviceName}&quot; as microphone in Zoom/Teams/Meet
        </div>
      )}

      {/* No devices warning */}
      {noDevices && (
        <div style={{
          fontSize: '12px',
          color: '#f59e0b',
          padding: '8px',
          background: '#1a1500',
          borderRadius: '6px',
          marginBottom: '6px'
        }}>
          No virtual audio device detected. Install{' '}
          <span style={{ color: '#93c5fd', textDecoration: 'underline', cursor: 'pointer' }}
            onClick={() => {
              // Open BlackHole download page in default browser
              window.open('https://existential.audio/blackhole/', '_blank')
            }}
          >BlackHole</span>{' '}
          (free, open-source) to enable this feature.
        </div>
      )}

      {/* Refresh button */}
      <button
        onClick={refreshDevices}
        disabled={disabled || loading}
        style={{
          fontSize: '12px',
          color: '#94a3b8',
          background: 'transparent',
          border: '1px solid #334155',
          borderRadius: '4px',
          padding: '4px 10px',
          cursor: disabled || loading ? 'default' : 'pointer',
          marginBottom: '6px'
        }}
      >
        Refresh Devices
      </button>

      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '4px' }}>
        Routes translated TTS audio to a virtual audio device so meeting participants
        can hear translations. Requires a virtual audio driver like BlackHole (2ch).
      </div>
    </Section>
  )
}
