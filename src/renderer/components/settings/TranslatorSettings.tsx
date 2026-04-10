import React from 'react'
import { GlossarySettings } from './GlossarySettings'
import { Section } from './Section'
import { API_ENGINE_MODES, LLM_ENGINE_MODES, inputStyle, radioLabelStyle, selectStyle } from './shared'
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
  // Adaptive routing (#547)
  adaptiveRoutingEnabled: boolean
  onAdaptiveRoutingEnabledChange: (v: boolean) => void
  adaptiveRoutingShortThreshold: number
  onAdaptiveRoutingShortThresholdChange: (v: number) => void
  adaptiveRoutingLongThreshold: number
  onAdaptiveRoutingLongThresholdChange: (v: number) => void
  adaptiveRoutingQualityEngine: string
  onAdaptiveRoutingQualityEngineChange: (v: string) => void
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
  // Organization glossary (#517)
  orgGlossaryTerms: Array<{ source: string; target: string }>
  onOrgGlossaryTermsChange: (terms: Array<{ source: string; target: string }>) => void
}

export function TranslatorSettings({
  engineMode,
  onEngineModeChange,
  platform,
  disabled,
  gpuInfo,
  slmKvCacheQuant,
  onSlmKvCacheQuantChange,
  simulMtEnabled,
  onSimulMtEnabledChange,
  simulMtWaitK,
  onSimulMtWaitKChange,
  adaptiveRoutingEnabled,
  onAdaptiveRoutingEnabledChange,
  adaptiveRoutingShortThreshold,
  onAdaptiveRoutingShortThresholdChange,
  adaptiveRoutingLongThreshold,
  onAdaptiveRoutingLongThresholdChange,
  adaptiveRoutingQualityEngine,
  onAdaptiveRoutingQualityEngineChange,
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
  onGlossaryTermsChange,
  orgGlossaryTerms,
  onOrgGlossaryTermsChange
}: TranslatorSettingsProps): React.JSX.Element {
  const showLlmOptions = LLM_ENGINE_MODES.includes(engineMode)
  const isApiEngine = API_ENGINE_MODES.includes(engineMode)

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
            checked={engineMode === 'offline-hymt15'}
            onChange={() => onEngineModeChange('offline-hymt15')}
            disabled={disabled}
          />
          <div>
            <div style={{ fontWeight: 500 }}>HY-MT 1.5 (Recommended)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Fast + high quality, 36 languages, ~1GB — surpasses Google/DeepL</div>
          </div>
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'offline-lfm2'}
            onChange={() => onEngineModeChange('offline-lfm2')}
            disabled={disabled}
          />
          <div>
            <div style={{ fontWeight: 500 }}>LFM2 (Ultra-fast, JA↔EN)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>350M params, ~230MB — GPT-4o-class quality at minimal cost</div>
          </div>
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'offline-plamo'}
            onChange={() => onEngineModeChange('offline-plamo')}
            disabled={disabled}
          />
          <div>
            <div style={{ fontWeight: 500 }}>PLaMo-2 10B (Quality, JA↔EN)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Japan Gov "Gennai" adopted, style-aware, ~5.5GB</div>
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
        {platform === 'darwin' && (
          <label style={radioLabelStyle}>
            <input
              type="radio"
              name="engine"
              checked={engineMode === 'offline-apple'}
              onChange={() => onEngineModeChange('offline-apple')}
              disabled={disabled}
            />
            <div>
              <div style={{ fontWeight: 500 }}>Apple Translate (Built-in)</div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>macOS 15+, zero config, on-device, ANE-optimized — no model download</div>
            </div>
          </label>
        )}
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
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'offline-opus'}
            onChange={() => onEngineModeChange('offline-opus')}
            disabled={disabled}
          />
          <div>
            <div style={{ fontWeight: 500 }}>OPUS-MT (Legacy Fallback)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>~200ms latency, ONNX accelerated — used as fallback while LLM models download</div>
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
                <div style={{ fontWeight: 500, fontSize: '12px' }}>Conversational SimulMT</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>Translate at clause boundaries with KV cache reuse — lower latency than debounced mode</div>
              </div>
            </label>
            {simulMtEnabled && (
              <div style={{ paddingLeft: '48px', marginTop: '-4px', marginBottom: '4px' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '4px' }}>
                  Wait-k: start after {simulMtWaitK} words/chars
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

        {/* Adaptive Quality Routing (#547) — only for offline LLM engines */}
        {showLlmOptions && (
          <div style={{ marginTop: '8px', paddingLeft: '24px' }}>
            <label style={radioLabelStyle}>
              <input
                type="checkbox"
                checked={adaptiveRoutingEnabled}
                onChange={(e) => onAdaptiveRoutingEnabledChange(e.target.checked)}
                disabled={disabled}
              />
              <div>
                <div style={{ fontWeight: 500, fontSize: '12px' }}>Adaptive quality routing</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  Auto-route: short sentences use fast engine, complex ones use quality engine
                </div>
              </div>
            </label>
            {adaptiveRoutingEnabled && (
              <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '2px' }}>
                    Quality engine
                  </div>
                  <select
                    value={adaptiveRoutingQualityEngine}
                    onChange={(e) => onAdaptiveRoutingQualityEngineChange(e.target.value)}
                    disabled={disabled}
                    style={{ ...selectStyle, fontSize: '12px', padding: '6px 8px' }}
                  >
                    <option value="hunyuan-mt">Hunyuan-MT 7B (~4GB)</option>
                    <option value="plamo">PLaMo-2 10B (~5.5GB)</option>
                  </select>
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '2px' }}>
                    Fast-only threshold: &lt;{adaptiveRoutingShortThreshold} tokens
                  </div>
                  <input
                    type="range"
                    aria-label="Short threshold"
                    min={3}
                    max={30}
                    value={adaptiveRoutingShortThreshold}
                    onChange={(e) => onAdaptiveRoutingShortThresholdChange(Number(e.target.value))}
                    disabled={disabled}
                    style={{ width: '100%' }}
                  />
                </div>
                <div>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '2px' }}>
                    Quality threshold: &gt;{adaptiveRoutingLongThreshold} tokens
                  </div>
                  <input
                    type="range"
                    aria-label="Long threshold"
                    min={20}
                    max={100}
                    value={adaptiveRoutingLongThreshold}
                    onChange={(e) => onAdaptiveRoutingLongThresholdChange(Number(e.target.value))}
                    disabled={disabled}
                    style={{ width: '100%' }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* API Translation — collapsed by default */}
        <div style={{ marginTop: '12px' }}>
          <button
            onClick={() => onShowApiOptionsChange(!showApiOptions)}
            aria-expanded={showApiOptions}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#cbd5e1',
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

      <GlossarySettings
        disabled={disabled}
        glossaryTerms={glossaryTerms}
        onGlossaryTermsChange={onGlossaryTermsChange}
        orgGlossaryTerms={orgGlossaryTerms}
        onOrgGlossaryTermsChange={onOrgGlossaryTermsChange}
      />
    </>
  )
}
