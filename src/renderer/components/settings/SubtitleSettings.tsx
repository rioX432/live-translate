import React from 'react'
import { Section } from './Section'
import { colorInputStyle, selectStyle, sliderLabelStyle } from './shared'
import type { DisplayInfo, SubtitlePositionType } from './shared'

interface SubtitleSettingsProps {
  fontSize: number
  onFontSizeChange: (v: number) => void
  sourceColor: string
  onSourceColorChange: (v: string) => void
  translatedColor: string
  onTranslatedColorChange: (v: string) => void
  bgOpacity: number
  onBgOpacityChange: (v: number) => void
  position: SubtitlePositionType
  onPositionChange: (v: SubtitlePositionType) => void
  displays: DisplayInfo[]
  selectedDisplay: number
  onDisplayChange: (displayId: number) => void
}

export function SubtitleSettings({
  fontSize,
  onFontSizeChange,
  sourceColor,
  onSourceColorChange,
  translatedColor,
  onTranslatedColorChange,
  bgOpacity,
  onBgOpacityChange,
  position,
  onPositionChange,
  displays,
  selectedDisplay,
  onDisplayChange
}: SubtitleSettingsProps): React.JSX.Element {
  return (
    <>
      <Section label="Subtitle Appearance">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <div>
            <div style={sliderLabelStyle}>Font Size: {fontSize}px</div>
            <input
              type="range"
              aria-label="Subtitle font size"
              min={20}
              max={48}
              value={fontSize}
              onChange={(e) => onFontSizeChange(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1 }}>
              <div style={sliderLabelStyle}>Source Text</div>
              <input
                type="color"
                value={sourceColor}
                onChange={(e) => onSourceColorChange(e.target.value)}
                style={colorInputStyle}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={sliderLabelStyle}>Translated Text</div>
              <input
                type="color"
                value={translatedColor}
                onChange={(e) => onTranslatedColorChange(e.target.value)}
                style={colorInputStyle}
              />
            </div>
          </div>
          <div>
            <div style={sliderLabelStyle}>Background Opacity: {bgOpacity}%</div>
            <input
              type="range"
              aria-label="Subtitle background opacity"
              min={0}
              max={100}
              value={bgOpacity}
              onChange={(e) => onBgOpacityChange(Number(e.target.value))}
              style={{ width: '100%' }}
            />
          </div>
          <div>
            <div style={sliderLabelStyle}>Position</div>
            <select
              value={position}
              onChange={(e) => onPositionChange(e.target.value as SubtitlePositionType)}
              style={selectStyle}
            >
              <option value="bottom">Bottom</option>
              <option value="top">Top</option>
            </select>
          </div>
        </div>
      </Section>

      <Section label="Subtitle Display">
        <select
          value={selectedDisplay}
          onChange={(e) => onDisplayChange(Number(e.target.value))}
          style={selectStyle}
          aria-label="Subtitle display"
        >
          {displays.map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>
      </Section>
    </>
  )
}
