import React, { useCallback, useEffect, useState } from 'react'
import { Section } from './Section'
import { selectStyle, sliderLabelStyle } from './shared'

/** Voice options by language group */
const TTS_VOICES: Record<string, Array<{ id: string; label: string }>> = {
  en: [
    { id: 'af_heart', label: 'Heart (F)' },
    { id: 'af_bella', label: 'Bella (F)' },
    { id: 'af_nova', label: 'Nova (F)' },
    { id: 'af_sarah', label: 'Sarah (F)' },
    { id: 'af_sky', label: 'Sky (F)' },
    { id: 'am_adam', label: 'Adam (M)' },
    { id: 'am_echo', label: 'Echo (M)' },
    { id: 'am_michael', label: 'Michael (M)' },
    { id: 'bf_alice', label: 'Alice (F, British)' },
    { id: 'bf_emma', label: 'Emma (F, British)' },
    { id: 'bm_daniel', label: 'Daniel (M, British)' },
    { id: 'bm_george', label: 'George (M, British)' }
  ],
  ja: [
    { id: 'jf_alpha', label: 'Alpha (F)' },
    { id: 'jf_gongitsune', label: 'Gongitsune (F)' },
    { id: 'jf_nezumi', label: 'Nezumi (F)' },
    { id: 'jf_tebukuro', label: 'Tebukuro (F)' },
    { id: 'jm_kumo', label: 'Kumo (M)' }
  ],
  zh: [
    { id: 'zf_xiaobei', label: 'Xiaobei (F)' },
    { id: 'zf_xiaoni', label: 'Xiaoni (F)' },
    { id: 'zm_yunjian', label: 'Yunjian (M)' },
    { id: 'zm_yunxi', label: 'Yunxi (M)' }
  ]
}

/** All voices flattened for the selector */
const ALL_VOICES = [
  { group: 'English', voices: TTS_VOICES.en! },
  { group: 'Japanese', voices: TTS_VOICES.ja! },
  { group: 'Chinese', voices: TTS_VOICES.zh! }
]

interface TTSSettingsProps {
  disabled: boolean
}

export function TTSSettings({ disabled }: TTSSettingsProps): React.JSX.Element {
  const [enabled, setEnabled] = useState(false)
  const [voice, setVoice] = useState('af_heart')
  const [volume, setVolume] = useState(0.8)
  const [outputDevice, setOutputDevice] = useState('')
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([])
  const [loading, setLoading] = useState(false)

  // Load saved settings on mount
  useEffect(() => {
    window.api.ttsGetSettings().then((settings) => {
      setEnabled(settings.enabled)
      setVoice(settings.voice)
      setVolume(settings.volume)
      setOutputDevice(settings.outputDevice)
    }).catch((err) => console.warn('Failed to load TTS settings:', err))

    // Enumerate audio output devices
    navigator.mediaDevices.enumerateDevices().then((devices) => {
      setOutputDevices(devices.filter((d) => d.kind === 'audiooutput'))
    }).catch((err) => console.warn('Failed to enumerate audio devices:', err))
  }, [])

  // Set up TTS audio playback listener
  useEffect(() => {
    const cleanup = window.api.onTtsAudio((data) => {
      playTtsAudio(data.audio, data.sampleRate, data.volume, outputDevice)
    })
    return cleanup
  }, [outputDevice])

  const handleToggle = useCallback(async (checked: boolean) => {
    setLoading(true)
    try {
      const result = await window.api.ttsSetEnabled(checked)
      if (result.error) {
        console.error('TTS enable failed:', result.error)
        setEnabled(false)
      } else {
        setEnabled(checked)
      }
    } catch {
      setEnabled(false)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleVoiceChange = useCallback((voiceId: string) => {
    setVoice(voiceId)
    window.api.ttsSetVoice(voiceId)
  }, [])

  const handleVolumeChange = useCallback((value: number) => {
    setVolume(value)
    window.api.ttsSetVolume(value)
  }, [])

  const handleOutputDeviceChange = useCallback((deviceId: string) => {
    setOutputDevice(deviceId)
    window.api.ttsSetOutputDevice(deviceId)
  }, [])

  return (
    <Section label="Text-to-Speech">
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
          disabled={disabled || loading}
          aria-label="Enable text-to-speech"
        />
        <span>
          {loading ? 'Loading Kokoro-82M model...' : 'Speak translated text (Kokoro-82M)'}
        </span>
      </label>

      {enabled && (
        <>
          {/* Voice selector */}
          <div style={sliderLabelStyle}>Voice</div>
          <select
            value={voice}
            onChange={(e) => handleVoiceChange(e.target.value)}
            style={{ ...selectStyle, marginBottom: '8px' }}
            disabled={disabled}
            aria-label="TTS voice"
          >
            {ALL_VOICES.map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.voices.map((v) => (
                  <option key={v.id} value={v.id}>{v.label}</option>
                ))}
              </optgroup>
            ))}
          </select>

          {/* Volume slider */}
          <div style={sliderLabelStyle}>Volume: {Math.round(volume * 100)}%</div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            style={{ width: '100%', marginBottom: '8px' }}
            disabled={disabled}
            aria-label="TTS volume"
          />

          {/* Output device selector */}
          {outputDevices.length > 0 && (
            <>
              <div style={sliderLabelStyle}>Output Device</div>
              <select
                value={outputDevice}
                onChange={(e) => handleOutputDeviceChange(e.target.value)}
                style={selectStyle}
                disabled={disabled}
                aria-label="TTS output device"
              >
                <option value="">Default</option>
                {outputDevices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || d.deviceId}
                  </option>
                ))}
              </select>
            </>
          )}
        </>
      )}

      <div style={{ fontSize: '11px', color: '#64748b', marginTop: '6px' }}>
        Offline TTS via Kokoro-82M (ONNX). Model downloads on first use (~80MB).
      </div>
    </Section>
  )
}

/**
 * Play TTS audio in the renderer via Web Audio API.
 * Supports routing to a specific output device via setSinkId.
 */
function playTtsAudio(
  audioData: number[],
  sampleRate: number,
  volume: number,
  outputDeviceId: string
): void {
  const samples = new Float32Array(audioData)
  if (samples.length === 0) return

  const audioCtx = new AudioContext({ sampleRate })
  const buffer = audioCtx.createBuffer(1, samples.length, sampleRate)
  buffer.copyToChannel(samples, 0)

  const source = audioCtx.createBufferSource()
  source.buffer = buffer

  const gainNode = audioCtx.createGain()
  gainNode.gain.value = volume

  source.connect(gainNode)
  gainNode.connect(audioCtx.destination)

  // Route to specific output device if supported and specified
  if (outputDeviceId && 'setSinkId' in audioCtx) {
    (audioCtx as AudioContextWithSink).setSinkId(outputDeviceId).catch(() => {
      // Fallback to default device if setSinkId fails
    })
  }

  source.onended = (): void => {
    audioCtx.close().catch((err) => console.warn('AudioContext close failed:', err))
  }

  source.start()
}

/** AudioContext with setSinkId support (Chrome/Electron) */
interface AudioContextWithSink extends AudioContext {
  setSinkId(sinkId: string): Promise<void>
}
