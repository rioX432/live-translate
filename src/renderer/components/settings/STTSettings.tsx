import React from 'react'
import { Section } from './Section'
import { selectStyle } from './shared'
import type { SttEngineType, WhisperVariantType, SourceLanguage } from './shared'

interface STTSettingsProps {
  sttEngine: SttEngineType
  onSttEngineChange: (v: SttEngineType) => void
  whisperVariant: WhisperVariantType
  onWhisperVariantChange: (v: WhisperVariantType) => void
  platform: string
  disabled: boolean
  sourceLanguage: SourceLanguage
  draftSttEnabled: boolean
  onDraftSttEnabledChange: (v: boolean) => void
}

export function STTSettings({
  sttEngine,
  onSttEngineChange,
  whisperVariant,
  onWhisperVariantChange,
  platform,
  disabled,
  sourceLanguage,
  draftSttEnabled,
  onDraftSttEnabledChange
}: STTSettingsProps): React.JSX.Element {
  // Kotoba-Whisper outputs JA only — show when source is JA or auto, on Apple Silicon
  const showKotobaWhisper = platform === 'darwin' && (sourceLanguage === 'ja' || sourceLanguage === 'auto')

  return (
    <Section label="Speech Recognition">
      <select
        value={sttEngine}
        onChange={(e) => onSttEngineChange(e.target.value as SttEngineType)}
        style={selectStyle}
        disabled={disabled}
        aria-label="STT engine"
      >
        {showKotobaWhisper && (
          <option value="kotoba-whisper">Kotoba-Whisper v2.0 (JA-optimized, Apple Silicon)</option>
        )}
        {platform === 'darwin' && (
          <option value="qwen3-asr">Qwen3-ASR 0.6B (Best accuracy, Apple Silicon)</option>
        )}
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
            <option value="distil-large-v3">Distil Large v3 (5x faster, ~1.5GB)</option>
            <option value="small">Small (Fast mode, ~466MB)</option>
            <option value="base">Base (Fastest mode, ~142MB)</option>
          </select>
          {whisperVariant === 'large-v3-turbo' && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
              OpenAI large-v3-turbo: 809M params, 4 decoder layers, within 1-2% WER of large-v3.
            </div>
          )}
          {whisperVariant === 'distil-large-v3' && (
            <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
              HuggingFace distil-large-v3: 756M params, 2 decoder layers, 5x faster with only 1% WER degradation vs large-v3.
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
      {sttEngine === 'kotoba-whisper' && (
        <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
          Kotoba-Whisper v2.0: JA CER 5.6% (31% better than MLX Whisper). Japanese output only.
          {sourceLanguage === 'auto' && (
            <span style={{ color: '#f59e0b' }}>
              {' '}Warning: this model only outputs Japanese. Set source language to JA for best results.
            </span>
          )}
        </div>
      )}
      {sttEngine === 'qwen3-asr' && (
        <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
          Qwen3-ASR 0.6B: JA CER 6.8%, EN WER 1.9% — best combined JA+EN accuracy.
          Requires{' '}
          <span style={{ fontFamily: 'monospace', fontSize: '10px' }}>speech-swift</span>
          {' '}(
          <span style={{ fontFamily: 'monospace', fontSize: '10px' }}>
            brew tap soniqo/speech https://github.com/soniqo/speech-swift &amp;&amp; brew install speech
          </span>
          ). Model (~600MB) auto-downloads on first use.
          <div style={{ marginTop: '2px', color: '#f59e0b' }}>
            Latency: ~2.2s per chunk (65% slower than MLX Whisper ~1.3s). Best for accuracy over speed.
          </div>
        </div>
      )}
      {sttEngine === 'mlx-whisper' && (
        <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
          MLX Whisper: optimized for Apple Silicon. JA CER 8.1%, EN WER 3.8%, ~3s latency.
        </div>
      )}
      {(sourceLanguage === 'ja' || sourceLanguage === 'auto') && (
        <div style={{ marginTop: '12px', borderTop: '1px solid #334155', paddingTop: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: '#e2e8f0', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={draftSttEnabled}
              onChange={(e) => onDraftSttEnabledChange(e.target.checked)}
              disabled={disabled}
              style={{ width: '16px', height: '16px' }}
            />
            Fast interim results (Moonshine Tiny JA)
          </label>
          <div style={{ marginTop: '4px', fontSize: '11px', color: '#94a3b8' }}>
            Uses ultra-fast draft STT (27M params, 845ms) for instant interim transcription while primary STT processes final results. Japanese source only.
          </div>
          {draftSttEnabled && sourceLanguage === 'auto' && (
            <div style={{ marginTop: '2px', fontSize: '11px', color: '#f59e0b' }}>
              Warning: draft STT outputs Japanese only. Non-JA audio will produce incorrect interim results.
            </div>
          )}
        </div>
      )}
    </Section>
  )
}
