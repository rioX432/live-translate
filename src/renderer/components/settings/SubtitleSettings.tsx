import React, { useCallback, useState } from 'react'
import { Section } from './Section'
import { buttonStyle, colorInputStyle, selectStyle, sliderLabelStyle } from './shared'
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
  showConfidenceIndicator: boolean
  onShowConfidenceIndicatorChange: (v: boolean) => void
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
  showConfidenceIndicator,
  onShowConfidenceIndicatorChange,
  displays,
  selectedDisplay,
  onDisplayChange
}: SubtitleSettingsProps): React.JSX.Element {
  const [isDragMode, setIsDragMode] = useState(false)

  const handleToggleDragMode = useCallback(() => {
    const next = !isDragMode
    setIsDragMode(next)
    window.api.toggleSubtitleDragMode?.(next)
  }, [isDragMode])

  const handleResetPosition = useCallback(() => {
    window.api.resetSubtitlePosition?.()
    // Also exit drag mode if active
    if (isDragMode) {
      setIsDragMode(false)
      window.api.toggleSubtitleDragMode?.(false)
    }
  }, [isDragMode])

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
          <label style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            marginTop: '4px',
            fontSize: '13px',
            color: '#94a3b8',
            cursor: 'pointer'
          }}>
            <input
              type="checkbox"
              checked={showConfidenceIndicator}
              onChange={(e) => onShowConfidenceIndicatorChange(e.target.checked)}
              aria-label="Show confidence indicator"
            />
            <span>Show confidence indicator</span>
          </label>
        </div>
      </Section>

      {/* Speaker color palette preview (#509) */}
      <Section label="Subtitle Display">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
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

          {/* Drag mode toggle and reset position (#509) */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={handleToggleDragMode}
              style={{
                ...buttonStyle,
                flex: 1,
                fontSize: '13px',
                padding: '8px 12px',
                marginTop: 0,
                background: isDragMode ? '#dc2626' : '#334155',
                fontWeight: 600
              }}
            >
              {isDragMode ? 'Done Repositioning' : 'Reposition Subtitles'}
            </button>
            <button
              onClick={handleResetPosition}
              style={{
                ...buttonStyle,
                flex: 0,
                whiteSpace: 'nowrap',
                fontSize: '13px',
                padding: '8px 12px',
                marginTop: 0,
                background: '#334155',
                fontWeight: 500
              }}
            >
              Reset
            </button>
          </div>
          {isDragMode && (
            <div style={{ fontSize: '11px', color: '#f59e0b' }}>
              Drag the subtitle overlay to your preferred position, then click "Done Repositioning"
            </div>
          )}
        </div>
      </Section>
    </>
  )
}
