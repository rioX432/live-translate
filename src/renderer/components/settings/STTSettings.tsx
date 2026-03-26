import React from 'react'
import { Section } from './Section'
import { selectStyle } from './shared'
import type { SttEngineType, WhisperVariantType } from './shared'

interface STTSettingsProps {
  sttEngine: SttEngineType
  onSttEngineChange: (v: SttEngineType) => void
  whisperVariant: WhisperVariantType
  onWhisperVariantChange: (v: WhisperVariantType) => void
  platform: string
  disabled: boolean
}

export function STTSettings({
  sttEngine,
  onSttEngineChange,
  whisperVariant,
  onWhisperVariantChange,
  platform,
  disabled
}: STTSettingsProps): React.JSX.Element {
  return (
    <Section label="Speech Recognition">
      <select
        value={sttEngine}
        onChange={(e) => onSttEngineChange(e.target.value as SttEngineType)}
        style={selectStyle}
        disabled={disabled}
        aria-label="STT engine"
      >
        {platform === 'darwin' && (
          <option value="mlx-whisper">mlx-whisper (Apple Silicon, recommended)</option>
        )}
        <option value="whisper-local">Whisper (whisper.cpp)</option>
      </select>
      {sttEngine === 'whisper-local' && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
            Whisper Model
          </div>
          <select
            value={whisperVariant}
            onChange={(e) => onWhisperVariantChange(e.target.value as WhisperVariantType)}
            style={selectStyle}
            disabled={disabled}
            aria-label="Whisper model variant"
          >
            <option value="kotoba-v2.0">Kotoba Whisper v2.0 (Japanese-optimized, ~540MB)</option>
            <option value="large-v3-turbo">Large v3 Turbo (Multilingual, 6x faster, ~600MB)</option>
            <option value="small">Small (Fast mode, ~466MB)</option>
            <option value="base">Base (Fastest mode, ~142MB)</option>
          </select>
          {whisperVariant === 'large-v3-turbo' && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
              OpenAI large-v3-turbo: 809M params, 4 decoder layers, within 1-2% WER of large-v3.
            </div>
          )}
          {whisperVariant === 'small' && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: '#f59e0b' }}>
              Fast mode: lower latency (~1-2s) but reduced accuracy. Good for real-time with acceptable quality.
            </div>
          )}
          {whisperVariant === 'base' && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: '#f59e0b' }}>
              Fastest mode: minimal latency (&lt;1s) but significantly lower accuracy. Best for speed-critical use cases.
            </div>
          )}
        </div>
      )}
      {sttEngine === 'mlx-whisper' && (
        <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
          MLX Whisper: optimized for Apple Silicon. JA CER 8.1%, EN WER 3.8%, ~3s latency.
        </div>
      )}
    </Section>
  )
}
