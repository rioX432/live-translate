import React from 'react'
import { GlossarySettings } from './GlossarySettings'
import type { GlossaryTerm } from './glossary-terms'
import { Section } from './Section'
import { radioLabelStyle } from './shared'

interface TranslatorSettingsProps {
  disabled: boolean
  // GPU info
  gpuInfo: { hasGpu: boolean; gpuNames: string[] } | null
  simulMtEnabled: boolean
  onSimulMtEnabledChange: (v: boolean) => void
  simulMtWaitK: number
  onSimulMtWaitKChange: (v: number) => void
  // Glossary
  glossaryTerms: GlossaryTerm[]
  onGlossaryTermsChange: (terms: GlossaryTerm[]) => void
  // Organization glossary (#517)
  orgGlossaryTerms: GlossaryTerm[]
  onOrgGlossaryTermsChange: (terms: GlossaryTerm[]) => void
}

export function TranslatorSettings({
  disabled,
  gpuInfo,
  simulMtEnabled,
  onSimulMtEnabledChange,
  simulMtWaitK,
  onSimulMtWaitKChange,
  glossaryTerms,
  onGlossaryTermsChange,
  orgGlossaryTerms,
  onOrgGlossaryTermsChange
}: TranslatorSettingsProps): React.JSX.Element {
  return (
    <>
      <Section label="Translation" helpText="Translation runs on this device with Hy-MT2 1.8B.">
        {gpuInfo && !gpuInfo.hasGpu && (
          <div style={{ fontSize: '11px', color: '#f59e0b', padding: '4px 0' }}>
            No GPU detected — translation may be slow on CPU-only systems
          </div>
        )}
        <label style={radioLabelStyle}>
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
          <div style={{ paddingLeft: '24px', marginTop: '-4px', marginBottom: '4px' }}>
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
      </Section>

      <GlossarySettings
        glossaryTerms={glossaryTerms}
        onGlossaryTermsChange={onGlossaryTermsChange}
        orgGlossaryTerms={orgGlossaryTerms}
        onOrgGlossaryTermsChange={onOrgGlossaryTermsChange}
      />
    </>
  )
}
