import React from 'react'
import { Section } from './Section'
import { selectStyle } from './shared'
import type { SttEngineType, WhisperVariantType, MoonshineVariantType } from './shared'

interface STTSettingsProps {
  sttEngine: SttEngineType
  onSttEngineChange: (v: SttEngineType) => void
  whisperVariant: WhisperVariantType
  onWhisperVariantChange: (v: WhisperVariantType) => void
  moonshineVariant: MoonshineVariantType
  onMoonshineVariantChange: (v: MoonshineVariantType) => void
  platform: string
  disabled: boolean
}

export function STTSettings({
  sttEngine,
  onSttEngineChange,
  whisperVariant,
  onWhisperVariantChange,
  moonshineVariant,
  onMoonshineVariantChange,
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
        <option value="whisper-local">Whisper (whisper.cpp)</option>
        {platform === 'darwin' && (
          <option value="mlx-whisper">mlx-whisper (Apple Silicon, faster)</option>
        )}
        {platform === 'darwin' && (
          <option value="lightning-whisper">Lightning Whisper MLX (Apple Silicon, 10x faster)</option>
        )}
        <option value="moonshine">Moonshine AI (ultra-fast, experimental)</option>
        <option value="sensevoice">SenseVoice (CJK-optimized, 15x faster)</option>
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
          </select>
          {whisperVariant === 'large-v3-turbo' && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
              OpenAI large-v3-turbo: 809M params, 4 decoder layers, within 1-2% WER of large-v3.
            </div>
          )}
        </div>
      )}
      {sttEngine === 'moonshine' && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
            Moonshine Model
          </div>
          <select
            value={moonshineVariant}
            onChange={(e) => onMoonshineVariantChange(e.target.value as MoonshineVariantType)}
            style={selectStyle}
            disabled={disabled}
            aria-label="Moonshine model variant"
          >
            <option value="base">Base — 61M params, best accuracy (~130MB)</option>
            <option value="tiny">Tiny — 27M params, fastest (~60MB)</option>
          </select>
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#f59e0b' }}>
            English-focused. Japanese/CJK accuracy is unverified — switch to Whisper if results are poor.
          </div>
        </div>
      )}
      {sttEngine === 'lightning-whisper' && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
            Lightning Whisper MLX: ~10x faster than whisper.cpp on Apple Silicon. Supports all Whisper model sizes including distil variants.
            Requires: <code style={{ color: '#7dd3fc' }}>pip install lightning-whisper-mlx</code>
          </div>
        </div>
      )}
      {sttEngine === 'sensevoice' && (
        <div style={{ marginTop: '8px' }}>
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
            SenseVoice-Small: 15x faster than Whisper with strong CJK accuracy. Supports 50+ languages with emotion detection.
            Requires: <code style={{ color: '#7dd3fc' }}>pip install funasr torch torchaudio</code>
          </div>
        </div>
      )}
    </Section>
  )
}
