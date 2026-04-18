import React from 'react'
import { Section } from './Section'
import { ALL_LANGUAGES, LANGUAGE_LABELS, selectStyle } from './shared'
import type { Language, SourceLanguage } from './shared'

interface LanguageSettingsProps {
  sourceLanguage: SourceLanguage
  onSourceLanguageChange: (v: SourceLanguage) => void
  targetLanguage: Language
  onTargetLanguageChange: (v: Language) => void
  disabled: boolean
}

export function LanguageSettings({
  sourceLanguage,
  onSourceLanguageChange,
  targetLanguage,
  onTargetLanguageChange,
  disabled
}: LanguageSettingsProps): React.JSX.Element {
  return (
    <Section label="Language">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
            Source Language
          </div>
          <select
            value={sourceLanguage}
            onChange={(e) => {
              const newSource = e.target.value as SourceLanguage
              onSourceLanguageChange(newSource)
              if (newSource !== 'auto' && newSource === targetLanguage) {
                onTargetLanguageChange(newSource === 'en' ? 'ja' : 'en')
              }
            }}
            style={selectStyle}
            disabled={disabled}
            aria-label="Source language"
          >
            <option value="auto">Auto-detect</option>
            {ALL_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>{LANGUAGE_LABELS[lang]}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '11px', fontWeight: 600, color: '#94a3b8', marginBottom: '4px' }}>
            Target Language
          </div>
          <select
            value={targetLanguage}
            onChange={(e) => {
              const newTarget = e.target.value as Language
              onTargetLanguageChange(newTarget)
              if (sourceLanguage !== 'auto' && sourceLanguage === newTarget) {
                onSourceLanguageChange(newTarget === 'en' ? 'ja' : 'en')
              }
            }}
            style={selectStyle}
            disabled={disabled}
            aria-label="Target language"
          >
            {ALL_LANGUAGES.map((lang) => (
              <option key={lang} value={lang}>{LANGUAGE_LABELS[lang]}</option>
            ))}
          </select>
        </div>
      </div>
    </Section>
  )
}
