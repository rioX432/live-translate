import React from 'react'
import { Section } from './Section'
import { sliderLabelStyle } from './shared'

interface AccessibilitySettingsProps {
  highContrast: boolean
  onHighContrastChange: (v: boolean) => void
  dyslexiaFont: boolean
  onDyslexiaFontChange: (v: boolean) => void
  reducedMotion: boolean
  onReducedMotionChange: (v: boolean) => void
  letterSpacing: number
  onLetterSpacingChange: (v: number) => void
  wordSpacing: number
  onWordSpacingChange: (v: number) => void
}

const checkboxLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  fontSize: '13px',
  color: '#94a3b8',
  cursor: 'pointer'
}

export function AccessibilitySettings({
  highContrast,
  onHighContrastChange,
  dyslexiaFont,
  onDyslexiaFontChange,
  reducedMotion,
  onReducedMotionChange,
  letterSpacing,
  onLetterSpacingChange,
  wordSpacing,
  onWordSpacingChange
}: AccessibilitySettingsProps): React.JSX.Element {
  return (
    <Section label="Accessibility">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <label style={checkboxLabelStyle}>
          <input
            type="checkbox"
            checked={highContrast}
            onChange={(e) => onHighContrastChange(e.target.checked)}
            aria-label="High contrast mode"
          />
          <span>High contrast mode</span>
        </label>

        <label style={checkboxLabelStyle}>
          <input
            type="checkbox"
            checked={dyslexiaFont}
            onChange={(e) => onDyslexiaFontChange(e.target.checked)}
            aria-label="Dyslexia-friendly font"
          />
          <span>Dyslexia-friendly font (Atkinson Hyperlegible)</span>
        </label>

        <label style={checkboxLabelStyle}>
          <input
            type="checkbox"
            checked={reducedMotion}
            onChange={(e) => onReducedMotionChange(e.target.checked)}
            aria-label="Reduced motion"
          />
          <span>Reduced motion</span>
        </label>

        <div>
          <div style={sliderLabelStyle}>Letter Spacing: {letterSpacing.toFixed(2)}em</div>
          <input
            type="range"
            aria-label="Letter spacing"
            min={0}
            max={0.2}
            step={0.01}
            value={letterSpacing}
            onChange={(e) => onLetterSpacingChange(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        <div>
          <div style={sliderLabelStyle}>Word Spacing: {wordSpacing.toFixed(2)}em</div>
          <input
            type="range"
            aria-label="Word spacing"
            min={0}
            max={0.3}
            step={0.01}
            value={wordSpacing}
            onChange={(e) => onWordSpacingChange(Number(e.target.value))}
            style={{ width: '100%' }}
          />
        </div>

        {(letterSpacing > 0 || wordSpacing > 0) && (
          <div style={{ fontSize: '11px', color: '#94a3b8' }}>
            WCAG 1.4.12 recommends: letter 0.12em, word 0.16em
          </div>
        )}
      </div>
    </Section>
  )
}
