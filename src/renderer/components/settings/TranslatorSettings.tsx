import React, { useEffect, useState } from 'react'
import { Section } from './Section'
import { API_ENGINE_MODES, LLM_ENGINE_MODES, inputStyle, radioLabelStyle } from './shared'
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
  // Organization glossary (#517)
  orgGlossaryTerms: Array<{ source: string; target: string }>
  onOrgGlossaryTermsChange: (terms: Array<{ source: string; target: string }>) => void
}

/** Small action button style shared across glossary sections */
const glossaryButtonStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: '11px',
  fontWeight: 600,
  background: '#334155',
  color: '#e2e8f0',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  whiteSpace: 'nowrap'
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
  onGlossaryTermsChange,
  orgGlossaryTerms,
  onOrgGlossaryTermsChange
}: TranslatorSettingsProps): React.JSX.Element {
  const [newGlossarySource, setNewGlossarySource] = useState('')
  const [newGlossaryTarget, setNewGlossaryTarget] = useState('')
  const [glossaryStatus, setGlossaryStatus] = useState('')
  const [showOrgGlossary, setShowOrgGlossary] = useState(orgGlossaryTerms.length > 0)
  const [conflicts, setConflicts] = useState<Array<{ source: string; personalTarget: string; orgTarget: string }>>([])

  // Load conflict preview when glossaries change
  useEffect(() => {
    if (orgGlossaryTerms.length > 0 && glossaryTerms.length > 0) {
      window.api.getMergedGlossary().then((result) => {
        setConflicts(result.conflicts)
      }).catch(() => { /* ignore */ })
    } else {
      setConflicts([])
    }
  }, [glossaryTerms, orgGlossaryTerms])

  // Expand org section if org terms are loaded
  useEffect(() => {
    if (orgGlossaryTerms.length > 0) setShowOrgGlossary(true)
  }, [orgGlossaryTerms.length])

  const handleImport = async (target: 'personal' | 'org'): Promise<void> => {
    setGlossaryStatus('Importing...')
    try {
      const result = await window.api.importGlossary(target)
      if (result.canceled) {
        setGlossaryStatus('')
        return
      }
      if (result.error) {
        setGlossaryStatus(result.error)
        return
      }
      if (result.entries) {
        if (target === 'org') {
          onOrgGlossaryTermsChange(result.entries)
        } else {
          onGlossaryTermsChange(result.entries)
        }
        setGlossaryStatus(`Imported ${result.count} terms`)
      }
    } catch (err) {
      setGlossaryStatus(`Import failed: ${err}`)
    }
  }

  const handleExport = async (target: 'personal' | 'org', format: 'json' | 'csv'): Promise<void> => {
    setGlossaryStatus('Exporting...')
    try {
      const result = await window.api.exportGlossary(target, format)
      if (result.canceled) {
        setGlossaryStatus('')
        return
      }
      if (result.error) {
        setGlossaryStatus(result.error)
        return
      }
      setGlossaryStatus(`Exported ${result.count} terms`)
    } catch (err) {
      setGlossaryStatus(`Export failed: ${err}`)
    }
  }

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
            checked={engineMode === 'offline-opus'}
            onChange={() => onEngineModeChange('offline-opus')}
            disabled={disabled}
          />
          <div>
            <div style={{ fontWeight: 500 }}>OPUS-MT (Lightweight)</div>
            <div style={{ fontSize: '12px', color: '#94a3b8' }}>~200ms latency, ONNX accelerated — minimal resource usage</div>
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

      {/* Personal Glossary */}
      <Section label="Personal Glossary">
        <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
          Define fixed translations for specific terms (e.g. proper nouns).
        </div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
          <button onClick={() => handleImport('personal')} disabled={disabled} style={glossaryButtonStyle}>
            Import JSON/CSV
          </button>
          {glossaryTerms.length > 0 && (
            <>
              <button onClick={() => handleExport('personal', 'json')} disabled={disabled} style={glossaryButtonStyle}>
                Export JSON
              </button>
              <button onClick={() => handleExport('personal', 'csv')} disabled={disabled} style={glossaryButtonStyle}>
                Export CSV
              </button>
            </>
          )}
          <span style={{ fontSize: '11px', color: '#64748b', alignSelf: 'center' }}>
            {glossaryTerms.length} terms
          </span>
        </div>
        {glossaryTerms.length === 0 ? (
          <div
            style={{
              fontSize: '12px',
              color: '#64748b',
              textAlign: 'center',
              padding: '16px 0',
              borderBottom: '1px solid #1e293b'
            }}
          >
            No glossary terms added yet
          </div>
        ) : (
          <div style={{ marginBottom: '8px', maxHeight: '200px', overflowY: 'auto' }}>
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
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: '#e2e8f0',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={term.source}
                >
                  {term.source}
                </span>
                <span style={{ color: '#64748b', flexShrink: 0 }}>&rarr;</span>
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    color: '#93c5fd',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap'
                  }}
                  title={term.target}
                >
                  {term.target}
                </span>
                <button
                  onClick={() => {
                    const updated = glossaryTerms.filter((_, i) => i !== idx)
                    onGlossaryTermsChange(updated)
                    window.api.saveGlossary(updated)
                  }}
                  disabled={disabled}
                  style={{
                    padding: '8px 16px',
                    minHeight: '44px',
                    fontSize: '12px',
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

      {/* Organization Glossary (#517) */}
      <Section label="Organization Glossary">
        <button
          onClick={() => setShowOrgGlossary(!showOrgGlossary)}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#cbd5e1',
            fontSize: '12px',
            cursor: 'pointer',
            padding: '4px 0',
            display: 'flex',
            alignItems: 'center',
            gap: '6px'
          }}
        >
          <span style={{ transform: showOrgGlossary ? 'rotate(90deg)' : 'none', transition: 'transform 0.2s', fontSize: '10px' }}>
            &#9654;
          </span>
          Shared team glossary — org terms override personal when conflicts
        </button>

        {showOrgGlossary && (
          <div style={{ marginTop: '8px' }}>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '8px', flexWrap: 'wrap' }}>
              <button onClick={() => handleImport('org')} disabled={disabled} style={glossaryButtonStyle}>
                Import JSON/CSV
              </button>
              {orgGlossaryTerms.length > 0 && (
                <>
                  <button onClick={() => handleExport('org', 'json')} disabled={disabled} style={glossaryButtonStyle}>
                    Export JSON
                  </button>
                  <button onClick={() => handleExport('org', 'csv')} disabled={disabled} style={glossaryButtonStyle}>
                    Export CSV
                  </button>
                  <button
                    onClick={() => {
                      onOrgGlossaryTermsChange([])
                      window.api.saveOrgGlossary([])
                      setGlossaryStatus('Organization glossary cleared')
                    }}
                    disabled={disabled}
                    style={{ ...glossaryButtonStyle, color: '#ef4444' }}
                  >
                    Clear
                  </button>
                </>
              )}
              <span style={{ fontSize: '11px', color: '#64748b', alignSelf: 'center' }}>
                {orgGlossaryTerms.length} terms
              </span>
            </div>

            {orgGlossaryTerms.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#64748b', textAlign: 'center', padding: '12px 0' }}>
                No organization glossary imported. Import a JSON or CSV file shared by your team.
              </div>
            ) : (
              <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
                {orgGlossaryTerms.map((term, idx) => (
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
                    <span style={{ flex: 1, minWidth: 0, color: '#e2e8f0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={term.source}>
                      {term.source}
                    </span>
                    <span style={{ color: '#64748b', flexShrink: 0 }}>&rarr;</span>
                    <span style={{ flex: 1, minWidth: 0, color: '#a78bfa', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={term.target}>
                      {term.target}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {/* Conflict preview */}
            {conflicts.length > 0 && (
              <div style={{ marginTop: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, color: '#f59e0b', marginBottom: '4px' }}>
                  {conflicts.length} conflict{conflicts.length > 1 ? 's' : ''} (org overrides personal)
                </div>
                {conflicts.slice(0, 5).map((c, idx) => (
                  <div key={idx} style={{ fontSize: '11px', color: '#94a3b8', padding: '2px 0' }}>
                    <span style={{ color: '#e2e8f0' }}>{c.source}</span>
                    {' '}
                    <span style={{ textDecoration: 'line-through', color: '#64748b' }}>{c.personalTarget}</span>
                    {' '}
                    <span style={{ color: '#a78bfa' }}>{c.orgTarget}</span>
                  </div>
                ))}
                {conflicts.length > 5 && (
                  <div style={{ fontSize: '11px', color: '#64748b' }}>
                    ...and {conflicts.length - 5} more
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Status message */}
        {glossaryStatus && (
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '6px' }}>
            {glossaryStatus}
          </div>
        )}
      </Section>
    </>
  )
}
