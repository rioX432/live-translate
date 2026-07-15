import React from 'react'
import { GlossarySettings } from './GlossarySettings'
import { Section } from './Section'
import { LLM_ENGINE_MODES, disclosureArrowStyle, disclosureToggleStyle, inputStyle, radioLabelStyle, selectStyle } from './shared'
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
  slmSpeculativeDecoding: boolean
  onSlmSpeculativeDecodingChange: (v: boolean) => void
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
  // Cloud realtime interpretation (#722, BYOK)
  openaiApiKey: string
  onOpenaiApiKeyChange: (v: string) => void
  cloudRealtimeEnabled: boolean
  onCloudRealtimeEnabledChange: (v: boolean) => void
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
  slmSpeculativeDecoding,
  onSlmSpeculativeDecodingChange,
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
  openaiApiKey,
  onOpenaiApiKeyChange,
  cloudRealtimeEnabled,
  onCloudRealtimeEnabledChange,
  showApiOptions,
  onShowApiOptionsChange,
  glossaryTerms,
  onGlossaryTermsChange,
  orgGlossaryTerms,
  onOrgGlossaryTermsChange
}: TranslatorSettingsProps): React.JSX.Element {
  const showLlmOptions = LLM_ENGINE_MODES.includes(engineMode)

  // 'rotation' (API auto) requires at least one API key — disabled when none configured
  const hasAnyApiKey = !!(apiKey || deeplApiKey || geminiApiKey || (microsoftApiKey && microsoftRegion))

  // #722: cloud realtime interpretation needs an OpenAI key (BYOK)
  const hasOpenaiKey = !!openaiApiKey

  return (
    <>
      <Section label="Translation Engine" helpText="Auto picks the best engine for your setup. HY-MT 1.5 is the recommended offline default.">
        <fieldset style={{ border: 'none', margin: 0, padding: 0 }}>
        <legend style={{ position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0,0,0,0)' }}>Translation Engine</legend>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'auto'}
            onChange={() => onEngineModeChange('auto')}
            disabled={disabled}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Auto (Recommended)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Picks the best engine for your hardware and API keys</div>
          </div>
        </label>
        <label style={radioLabelStyle}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'offline-hymt15'}
            onChange={() => onEngineModeChange('offline-hymt15')}
            disabled={disabled}
          />
          <div>
            <div style={{ fontWeight: 500 }}>HY-MT 1.5 (Offline default)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>Fast + high quality, 36 languages, ~1GB — surpasses Google/DeepL</div>
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
            <div style={{ fontWeight: 500 }}>Hunyuan-MT 7B (High Quality, GPU recommended)</div>
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
              <div style={{ fontWeight: 500 }}>Apple Translate (Built-in, macOS 15+)</div>
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>Zero config, on-device, ANE-optimized — no model download</div>
            </div>
          </label>
        )}
        <label style={{ ...radioLabelStyle, opacity: hasAnyApiKey ? 1 : 0.5 }}>
          <input
            type="radio"
            name="engine"
            checked={engineMode === 'rotation'}
            onChange={() => onEngineModeChange('rotation')}
            disabled={disabled || !hasAnyApiKey}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Online API (Auto Rotation)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              {hasAnyApiKey
                ? 'Azure → Google → DeepL → Gemini — up to 4M+ chars/month free'
                : 'Configure an API key below to enable cloud translation'}
            </div>
          </div>
        </label>

        {/* LLM sub-options for HY-MT 1.5 and Hunyuan-MT 7B */}
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
            {(engineMode === 'offline-hymt15' || engineMode === 'offline-hunyuan-mt') && (
              <label style={{ ...radioLabelStyle, paddingLeft: '24px' }}>
                <input
                  type="checkbox"
                  checked={slmSpeculativeDecoding}
                  onChange={(e) => onSlmSpeculativeDecodingChange(e.target.checked)}
                  disabled={disabled}
                />
                <div>
                  <div style={{ fontWeight: 500, fontSize: '12px' }}>Speculative decoding (LFM2 draft)</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    LFM2-350M generates draft tokens, verified by the main model — 1.5-2x faster
                  </div>
                  <div style={{ fontSize: '10px', color: '#64748b' }}>
                    Requires LFM2 model (~230MB). Extra memory: ~230MB on top of the main model.
                  </div>
                </div>
              </label>
            )}
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
                    <option value="hunyuan-mt">Hunyuan-MT 7B (Quality, ~4GB)</option>
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
                {adaptiveRoutingShortThreshold >= adaptiveRoutingLongThreshold && (
                  <div style={{ fontSize: '11px', color: '#f59e0b', marginTop: '4px' }}>
                    Warning: thresholds overlap — all text will use the fast engine only
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* API Keys — collapsed by default. Enables 'Online API' option above. */}
        <div style={{ marginTop: '12px' }}>
          <button
            onClick={() => onShowApiOptionsChange(!showApiOptions)}
            aria-expanded={showApiOptions}
            style={disclosureToggleStyle}
          >
            <span style={disclosureArrowStyle(showApiOptions)}>
              ▶
            </span>
            API Keys (optional — enables online translation)
          </button>

          {showApiOptions && (
            <div style={{ marginTop: '4px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => onApiKeyChange(e.target.value)}
                placeholder="Google Cloud Translation key"
                aria-label="Google Cloud Translation API key"
                style={inputStyle}
                disabled={disabled}
              />
              <input
                type="password"
                value={deeplApiKey}
                onChange={(e) => onDeeplApiKeyChange(e.target.value)}
                placeholder="DeepL API key"
                aria-label="DeepL API key"
                style={inputStyle}
                disabled={disabled}
              />
              <input
                type="password"
                value={geminiApiKey}
                onChange={(e) => onGeminiApiKeyChange(e.target.value)}
                placeholder="Gemini API key"
                aria-label="Gemini API key"
                style={inputStyle}
                disabled={disabled}
              />
              <input
                type="password"
                value={microsoftApiKey}
                onChange={(e) => onMicrosoftApiKeyChange(e.target.value)}
                placeholder="Azure Microsoft Translator key"
                aria-label="Azure Microsoft Translator key"
                style={inputStyle}
                disabled={disabled}
              />
              <input
                type="text"
                value={microsoftRegion}
                onChange={(e) => onMicrosoftRegionChange(e.target.value)}
                placeholder="Azure region (e.g. eastus)"
                aria-label="Azure region"
                style={inputStyle}
                disabled={disabled}
              />
              <input
                type="password"
                value={openaiApiKey}
                onChange={(e) => onOpenaiApiKeyChange(e.target.value)}
                placeholder="OpenAI API key (realtime interpretation)"
                aria-label="OpenAI API key"
                style={inputStyle}
                disabled={disabled}
              />
            </div>
          )}
        </div>
        </fieldset>
      </Section>

      {/* #722: Cloud realtime interpretation — a separate capability axis from the
          engine radios above, so the 4-engine UI cap is respected. Opt-in, BYOK,
          off by default (local-first stays Core Value ①). */}
      <Section
        label="Realtime Interpretation (Cloud)"
        helpText="Speech-native low-latency translation via OpenAI gpt-realtime-translate. Requires an OpenAI API key and sends audio to the cloud — off by default to keep the offline local-first engines as the default."
      >
        <label style={{ ...radioLabelStyle, opacity: hasOpenaiKey ? 1 : 0.5 }}>
          <input
            type="checkbox"
            checked={cloudRealtimeEnabled}
            onChange={(e) => onCloudRealtimeEnabledChange(e.target.checked)}
            disabled={disabled || !hasOpenaiKey}
          />
          <div>
            <div style={{ fontWeight: 500 }}>Enable cloud realtime interpretation (BYOK)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>
              {hasOpenaiKey
                ? 'Overrides the engine above while active. Cloud — audio leaves your device. ~$0.034/min. Output language follows your target-language setting.'
                : 'Add an OpenAI API key in "API Keys" above to enable cloud realtime interpretation.'}
            </div>
          </div>
        </label>
        {cloudRealtimeEnabled && hasOpenaiKey && (
          <div style={{ fontSize: '11px', color: '#f59e0b', padding: '4px 0 0 24px' }}>
            Cloud mode active — the offline engine selection above is bypassed while this is on.
          </div>
        )}
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
