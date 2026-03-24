import React, { useState } from 'react'
import { Section } from './Section'
import { inputStyle, radioLabelStyle } from './shared'
import type { EngineMode } from './shared'

interface TranslatorSettingsProps {
  engineMode: EngineMode
  onEngineModeChange: (v: EngineMode) => void
  platform: string
  disabled: boolean
  // GPU info
  gpuInfo: { hasGpu: boolean; gpuNames: string[] } | null
  // SLM options (for Hunyuan-MT)
  slmKvCacheQuant: boolean
  onSlmKvCacheQuantChange: (v: boolean) => void
  simulMtEnabled: boolean
  onSimulMtEnabledChange: (v: boolean) => void
  simulMtWaitK: number
  onSimulMtWaitKChange: (v: number) => void
  // API keys
  apiKey: string
  onApiKeyChange: (v: string) => void
  deeplApiKey: string
  onDeeplApiKeyChange: (v: string) => void
  geminiApiKey: string
  onGeminiApiKeyChange: (v: string) => void
  microsoftApiKey: string
  onMicrosoftApiKeyChange: (v: string) => void
  microsoftRegion: string
  onMicrosoftRegionChange: (v: string) => void
  // API options visibility (controlled by parent for settings restore)
  showApiOptions: boolean
  onShowApiOptionsChange: (v: boolean) => void
  // Glossary
  glossaryTerms: Array<{ source: string; target: string }>
  onGlossaryTermsChange: (terms: Array<{ source: string; target: string }>) => void
}

export function TranslatorSettings({
  engineMode,
  onEngineModeChange,
  disabled,
  gpuInfo,
  slmKvCacheQuant,
  onSlmKvCacheQuantChange,
  simulMtEnabled,
  onSimulMtEnabledChange,
  simulMtWaitK,
  onSimulMtWaitKChange,
  apiKey,
  onApiKeyChange,
  deeplApiKey,
  onDeeplApiKeyChange,
  geminiApiKey,
  onGeminiApiKeyChange,
  microsoftApiKey,
  onMicrosoftApiKeyChange,
  microsoftRegion,
  onMicrosoftRegionChange,
  showApiOptions,
  onShowApiOptionsChange,
  glossaryTerms,
  onGlossaryTermsChange
}: TranslatorSettingsProps): React.JSX.Element {
  const [newGlossarySource, setNewGlossarySource] = useState('')
  const [newGlossaryTarget, setNewGlossaryTarget] = useState('')

  const showLlmOptions = ['offline-hunyuan-mt', 'offline-hybrid'].includes(engineMode)
  const isApiEngine = ['rotation', 'online', 'online-deepl', 'online-gemini'].includes(engineMode)

  return (
    <>
      <Section label="Translation Engine" role="radiogroup">
        <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
          Offline
        </div>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'offline-opus'}
            onChange={() => onEngineModeChange('offline-opus')}
            disabled={disabled}
          />
          <div>
            <div style={{ fontWeight: 500 }}>OPUS-MT (Recommended)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>~280ms latency, ~1GB memory — best speed/quality balance</div>
          </div>
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'offline-hunyuan-mt'}
            onChange={() => onEngineModeChange('offline-hunyuan-mt')}
            disabled={disabled}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Hunyuan-MT 7B (High Quality)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>WMT25 winner, 33 languages, ~4GB — slower but higher quality</div>
          </div>
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'offline-hybrid'}
            onChange={() => onEngineModeChange('offline-hybrid')}
            disabled={disabled}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Hybrid (OPUS-MT + TranslateGemma)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Instant draft + LLM refinement — best offline quality</div>
          </div>
        </label>

        {/* LLM sub-options for Hunyuan-MT and Hybrid */}
        {showLlmOptions && (
          <>
            {gpuInfo && !gpuInfo.hasGpu && (
              <div style={{ fontSize: '11px', color: '#f59e0b', padding: '4px 0 4px 24px' }}>
                No GPU detected — translation may be slow on CPU-only systems
              </div>
            )}
            <label style={{ ...radioLabelStyle, paddingLeft: '24px' }}>
              <input
                type="checkbox"
                checked={slmKvCacheQuant}
                onChange={(e) => onSlmKvCacheQuantChange(e.target.checked)}
                disabled={disabled}
              />
              <div>
                <div style={{ fontWeight: 500, fontSize: '12px' }}>KV cache quantization (Q8_0)</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>Reduces VRAM ~50%</div>
              </div>
            </label>
            <label style={{ ...radioLabelStyle, paddingLeft: '24px' }}>
              <input
                type="checkbox"
                checked={simulMtEnabled}
                onChange={(e) => onSimulMtEnabledChange(e.target.checked)}
                disabled={disabled}
              />
              <div>
                <div style={{ fontWeight: 500, fontSize: '12px' }}>Simultaneous translation (SimulMT)</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>Start translating before speaker finishes</div>
              </div>
            </label>
            {simulMtEnabled && (
              <div style={{ paddingLeft: '48px', marginTop: '-4px', marginBottom: '4px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                  Wait-k: start after {simulMtWaitK} confirmed words
                </div>
                <input
                  type="range"
                  aria-label="Wait-k value"
                  min={1}
                  max={10}
                  value={simulMtWaitK}
                  onChange={(e) => onSimulMtWaitKChange(Number(e.target.value))}
                  disabled={disabled}
                  style={{ width: '100%' }}
                />
              </div>
            )}
          </>
        )}

        {/* API Translation — collapsed by default */}
        <div style={{ marginTop: '12px' }}>
          <button
            onClick={() => onShowApiOptionsChange(!showApiOptions)}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              fontSize: '11px',
              fontWeight: 600,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              cursor: 'pointer',
              padding: '4px 0',
              display: 'flex',
              alignItems: 'center',
              gap: '6px'
            }}
          >
            <span style={{ transform: showApiOptions ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', fontSize: '10px' }}>
              ▶
            </span>
            API Translation (requires internet)
          </button>

          {showApiOptions && (
            <div style={{ marginTop: '4px' }}>
              <label style={radioLabelStyle}>
                <input
                  type="radio"
                  name="engine"
                  checked={engineMode === 'rotation'}
                  onChange={() => onEngineModeChange('rotation')}
                  disabled={disabled}
                />
                <div>
                  <div style={{ fontWeight: 500 }}>Auto Rotation — up to 4M+ chars/month free</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>Azure → Google → DeepL → Gemini</div>
                </div>
              </label>
              <label style={radioLabelStyle}>
                <input
                  type="radio"
                  name="engine"
                  checked={engineMode === 'online'}
                  onChange={() => onEngineModeChange('online')}
                  disabled={disabled}
                />
                <div style={{ fontWeight: 500 }}>Google Translation</div>
              </label>
              <label style={radioLabelStyle}>
                <input
                  type="radio"
                  name="engine"
                  checked={engineMode === 'online-deepl'}
                  onChange={() => onEngineModeChange('online-deepl')}
                  disabled={disabled}
                />
                <div style={{ fontWeight: 500 }}>DeepL</div>
              </label>
              <label style={radioLabelStyle}>
                <input
                  type="radio"
                  name="engine"
                  checked={engineMode === 'online-gemini'}
                  onChange={() => onEngineModeChange('online-gemini')}
                  disabled={disabled}
                />
                <div style={{ fontWeight: 500 }}>Gemini 2.5 Flash</div>
              </label>

              {/* API Keys */}
              {isApiEngine && (
                <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {(engineMode === 'rotation' || engineMode === 'online') && (
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => onApiKeyChange(e.target.value)}
                      placeholder="Google Cloud Translation key"
                      style={inputStyle}
                      disabled={disabled}
                    />
                  )}
                  {(engineMode === 'rotation' || engineMode === 'online-deepl') && (
                    <input
                      type="password"
                      value={deeplApiKey}
                      onChange={(e) => onDeeplApiKeyChange(e.target.value)}
                      placeholder="DeepL API key"
                      style={inputStyle}
                      disabled={disabled}
                    />
                  )}
                  {(engineMode === 'rotation' || engineMode === 'online-gemini') && (
                    <input
                      type="password"
                      value={geminiApiKey}
                      onChange={(e) => onGeminiApiKeyChange(e.target.value)}
                      placeholder="Gemini API key"
                      style={inputStyle}
                      disabled={disabled}
                    />
                  )}
                  {engineMode === 'rotation' && (
                    <>
                      <input
                        type="password"
                        value={microsoftApiKey}
                        onChange={(e) => onMicrosoftApiKeyChange(e.target.value)}
                        placeholder="Azure Microsoft Translator key"
                        style={inputStyle}
                        disabled={disabled}
                      />
                      <input
                        type="text"
                        value={microsoftRegion}
                        onChange={(e) => onMicrosoftRegionChange(e.target.value)}
                        placeholder="Azure region (e.g. eastus)"
                        style={inputStyle}
                        disabled={disabled}
                      />
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* Glossary */}
      <Section label="Translation Glossary">
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
          Define fixed translations for specific terms (e.g. proper nouns).
        </div>
        {glossaryTerms.length > 0 && (
          <div style={{ marginBottom: '8px' }}>
            {glossaryTerms.map((term, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '4px 0',
                  borderBottom: '1px solid #1e293b',
                  fontSize: '12px'
                }}
              >
                <span style={{ flex: 1, color: '#e2e8f0' }}>{term.source}</span>
                <span style={{ color: '#64748b' }}>&rarr;</span>
                <span style={{ flex: 1, color: '#93c5fd' }}>{term.target}</span>
                <button
                  onClick={() => {
                    const updated = glossaryTerms.filter((_, i) => i !== idx)
                    onGlossaryTermsChange(updated)
                    window.api.saveGlossary(updated)
                  }}
                  disabled={disabled}
                  style={{
                    padding: '2px 6px',
                    fontSize: '11px',
                    background: '#334155',
                    color: '#ef4444',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: disabled ? 'not-allowed' : 'pointer'
                  }}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="text"
            value={newGlossarySource}
            onChange={(e) => setNewGlossarySource(e.target.value)}
            placeholder="Source term"
            style={{ ...inputStyle, flex: 1, fontFamily: 'inherit' }}
            disabled={disabled}
          />
          <input
            type="text"
            value={newGlossaryTarget}
            onChange={(e) => setNewGlossaryTarget(e.target.value)}
            placeholder="Translation"
            style={{ ...inputStyle, flex: 1, fontFamily: 'inherit' }}
            disabled={disabled}
          />
          <button
            onClick={() => {
              if (!newGlossarySource.trim() || !newGlossaryTarget.trim()) return
              const updated = [...glossaryTerms, { source: newGlossarySource.trim(), target: newGlossaryTarget.trim() }]
              onGlossaryTermsChange(updated)
              window.api.saveGlossary(updated)
              setNewGlossarySource('')
              setNewGlossaryTarget('')
            }}
            disabled={disabled || !newGlossarySource.trim() || !newGlossaryTarget.trim()}
            style={{
              padding: '8px 12px',
              fontSize: '12px',
              fontWeight: 600,
              background: '#334155',
              color: '#e2e8f0',
              border: 'none',
              borderRadius: '6px',
              cursor: (disabled || !newGlossarySource.trim() || !newGlossaryTarget.trim()) ? 'not-allowed' : 'pointer',
              whiteSpace: 'nowrap'
            }}
          >
            Add
          </button>
        </div>
      </Section>
    </>
  )
}
