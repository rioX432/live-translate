import React, { useCallback, useEffect, useRef, useState } from 'react'

interface AccessibilityConfig {
  highContrast: boolean
  dyslexiaFont: boolean
  reducedMotion: boolean
  letterSpacing: number
  wordSpacing: number
}

const DEFAULT_ACCESSIBILITY: AccessibilityConfig = {
  highContrast: false,
  dyslexiaFont: false,
  reducedMotion: false,
  letterSpacing: 0,
  wordSpacing: 0
}

interface SubtitleConfig {
  fontSize: number
  sourceTextColor: string
  translatedTextColor: string
  backgroundOpacity: number
  position: 'top' | 'bottom'
  accessibility: AccessibilityConfig
  showConfidenceIndicator: boolean
}

const DEFAULT_CONFIG: SubtitleConfig = {
  fontSize: 30,
  sourceTextColor: '#ffffff',
  translatedTextColor: '#7dd3fc',
  backgroundOpacity: 78,
  position: 'bottom',
  accessibility: DEFAULT_ACCESSIBILITY,
  showConfidenceIndicator: true
}

/** Silence timeout before subtitle fades out */
const SILENCE_TIMEOUT_MS = 4000
/** Fade-out transition duration */
const FADE_OUT_MS = 800

/** Dimmed color for interim (unconfirmed) text */
const INTERIM_TEXT_COLOR = 'rgba(255, 255, 255, 0.7)'

/**
 * Speaker color palette for diarization (#549).
 * Max 6 distinct colors — high contrast on dark background.
 */
const SPEAKER_COLORS = [
  '#60a5fa', // blue
  '#34d399', // green
  '#fbbf24', // amber
  '#f87171', // red
  '#a78bfa', // purple
  '#fb923c'  // orange
]

/** Font stack with Noto Sans CJK for broader coverage */
const BASE_FONT_FAMILY =
  '"Noto Sans", "Noto Sans CJK JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

/** Dyslexia-friendly font stack */
const DYSLEXIA_FONT_FAMILY =
  '"Atkinson Hyperlegible", "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

/**
 * Map a confidence score (0–1) to an opacity value for text rendering.
 * High confidence = full opacity, low confidence = reduced opacity.
 * Minimum opacity is 0.4 to keep text readable.
 */
function confidenceToOpacity(score: number): number {
  return 0.4 + 0.6 * Math.max(0, Math.min(1, score))
}

/**
 * Map a confidence score (0–1) to an underline thickness for high-contrast mode.
 * Low confidence = thick underline as a visual warning, high confidence = no underline.
 */
function confidenceToUnderline(score: number): string {
  if (score >= 0.8) return 'none'
  if (score >= 0.6) return 'underline 1px'
  if (score >= 0.4) return 'underline 2px'
  return 'underline 3px wavy'
}

/**
 * Render translated text with per-token confidence visualization.
 * If tokenConfidences is provided, each whitespace-delimited token gets individual styling.
 * Otherwise, uses the sentence-level confidence for uniform styling.
 */
function ConfidenceText({
  text,
  confidence,
  tokenConfidences,
  color,
  highContrast,
  style
}: {
  text: string
  confidence?: number
  tokenConfidences?: number[]
  color: string
  highContrast: boolean
  style?: React.CSSProperties
}): React.JSX.Element {
  // If no confidence data, render plain text
  if (confidence === undefined && !tokenConfidences?.length) {
    return <span style={{ color, ...style }}>{text}</span>
  }

  // If per-token confidences available, render each token individually
  if (tokenConfidences && tokenConfidences.length > 0) {
    const tokens = text.split(/(\s+)/)
    let tokenIdx = 0

    return (
      <span style={style}>
        {tokens.map((token, i) => {
          // Whitespace tokens: render as-is
          if (/^\s+$/.test(token)) {
            return <span key={i}>{token}</span>
          }

          const score = tokenIdx < tokenConfidences.length
            ? tokenConfidences[tokenIdx]
            : 1.0
          tokenIdx++

          if (highContrast) {
            return (
              <span
                key={i}
                style={{
                  color,
                  textDecoration: confidenceToUnderline(score)
                }}
                title={`Confidence: ${Math.round(score * 100)}%`}
              >
                {token}
              </span>
            )
          }

          return (
            <span
              key={i}
              style={{
                color,
                opacity: confidenceToOpacity(score)
              }}
              title={`Confidence: ${Math.round(score * 100)}%`}
            >
              {token}
            </span>
          )
        })}
      </span>
    )
  }

  // Sentence-level confidence: apply uniform styling to entire text
  const score = confidence ?? 1.0
  if (highContrast) {
    return (
      <span style={{
        color,
        textDecoration: confidenceToUnderline(score),
        ...style
      }}>
        {text}
      </span>
    )
  }

  return (
    <span style={{
      color,
      opacity: confidenceToOpacity(score),
      ...style
    }}>
      {text}
    </span>
  )
}

interface ResultData {
  sourceText: string
  translatedText: string
  confirmedText?: string
  interimText?: string
  speakerLabel?: string
  speakerIndex?: number
  /** Sentence-level confidence from STT (0.0–1.0) */
  confidence?: number
  /** Per-token confidence scores for translated text (0.0–1.0 each) */
  tokenConfidences?: number[]
}

function SubtitleOverlay(): React.JSX.Element {
  const [confirmedText, setConfirmedText] = useState('')
  const [interimText, setInterimText] = useState('')
  const [translatedText, setTranslatedText] = useState('')
  const [visible, setVisible] = useState(false)
  const [confidence, setConfidence] = useState<number | undefined>(undefined)
  const [tokenConfidences, setTokenConfidences] = useState<number[] | undefined>(undefined)
  const [speakerLabel, setSpeakerLabel] = useState<string | null>(null)
  const [speakerIndex, setSpeakerIndex] = useState<number>(0)
  const [config, setConfig] = useState<SubtitleConfig>(DEFAULT_CONFIG)
  const [isDragMode, setIsDragMode] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [editSaving, setEditSaving] = useState(false)
  const editInputRef = useRef<HTMLInputElement>(null)
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ screenX: 0, screenY: 0 })

  const a11y = config.accessibility

  const resetSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    silenceTimerRef.current = setTimeout(() => {
      setVisible(false)
    }, SILENCE_TIMEOUT_MS)
  }, [])

  const handleResult = useCallback((data: unknown) => {
    const result = data as ResultData
    if (!result.sourceText?.trim()) return

    // If confirmed/interim split is available, use it for stable display
    if (result.confirmedText !== undefined) {
      setConfirmedText(result.confirmedText)
      setInterimText(result.interimText ?? '')
    } else {
      // Final result or non-streaming: all text is confirmed
      setConfirmedText(result.sourceText)
      setInterimText('')
    }

    if (result.translatedText) {
      setTranslatedText(result.translatedText)
    }

    // Update confidence data for visualization (#581)
    setConfidence(result.confidence)
    setTokenConfidences(result.tokenConfidences)

    // Update speaker label from diarization (#549)
    if (result.speakerLabel !== undefined) {
      setSpeakerLabel(result.speakerLabel)
      setSpeakerIndex(result.speakerIndex ?? 0)
    }

    setVisible(true)
    resetSilenceTimer()
  }, [resetSilenceTimer])

  // Drag handlers
  const handleDragMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true
    dragStartRef.current = { screenX: e.screenX, screenY: e.screenY }
    e.preventDefault()
  }, [])

  useEffect(() => {
    if (!isDragMode) return

    const handleMouseMove = (e: MouseEvent): void => {
      if (!isDraggingRef.current) return
      const dx = e.screenX - dragStartRef.current.screenX
      const dy = e.screenY - dragStartRef.current.screenY
      dragStartRef.current = { screenX: e.screenX, screenY: e.screenY }
      window.api.moveSubtitleByDelta?.(dx, dy)
    }

    const handleMouseUp = (): void => {
      if (isDraggingRef.current) {
        isDraggingRef.current = false
        window.api.saveSubtitlePosition?.()
      }
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
    return () => {
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }
  }, [isDragMode])

  // Load initial settings and listen for changes
  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (s.subtitleSettings) {
        setConfig((prev) => ({
          ...prev,
          ...s.subtitleSettings as Partial<SubtitleConfig>,
          accessibility: {
            ...DEFAULT_ACCESSIBILITY,
            ...(s.subtitleSettings as Record<string, unknown>).accessibility as Partial<AccessibilityConfig>
          }
        }))
      }
      // showConfidenceIndicator may come as top-level or inside subtitleSettings
      if (s.showConfidenceIndicator !== undefined) {
        setConfig((prev) => ({ ...prev, showConfidenceIndicator: s.showConfidenceIndicator as boolean }))
      }
    })

    const unsubscribe = window.api.onSubtitleSettingsChanged((settings) => {
      const s = settings as Partial<SubtitleConfig>
      setConfig((prev) => ({
        ...prev,
        ...s,
        accessibility: {
          ...prev.accessibility,
          ...(s.accessibility ?? {})
        }
      }))
    })

    const unsubDrag = window.api.onDragModeChanged?.((enabled: boolean) => {
      setIsDragMode(enabled)
    })

    const unsubEdit = window.api.onEditModeChanged?.((enabled: boolean) => {
      setIsEditMode(enabled)
      if (!enabled) {
        setIsEditing(false)
        setEditValue('')
      }
    })

    return () => {
      unsubscribe?.()
      unsubDrag?.()
      unsubEdit?.()
    }
  }, [])

  // Subscribe to all result types — unified handler
  useEffect(() => {
    const unsubResult = window.api.onTranslationResult(handleResult)
    const unsubInterim = window.api.onInterimResult(handleResult)
    const unsubDraft = window.api.onDraftResult(handleResult)

    return () => {
      unsubResult?.()
      unsubInterim?.()
      unsubDraft?.()
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current)
    }
  }, [handleResult])

  // Edit mode: click translated text to start editing (#590)
  const handleTranslationClick = useCallback(() => {
    if (!isEditMode || isEditing || !translatedText) return
    setEditValue(translatedText)
    setIsEditing(true)
    // Focus the input on next render
    setTimeout(() => editInputRef.current?.focus(), 0)
  }, [isEditMode, isEditing, translatedText])

  // Save the corrected translation as a glossary entry (#590)
  const handleEditSave = useCallback(async () => {
    const trimmed = editValue.trim()
    if (!trimmed || trimmed === translatedText || editSaving) return

    setEditSaving(true)
    try {
      await window.api.saveCorrection?.({
        sourceText: confirmedText,
        originalTranslation: translatedText,
        correctedTranslation: trimmed
      })
      setTranslatedText(trimmed)
    } finally {
      setEditSaving(false)
      setIsEditing(false)
      setEditValue('')
    }
  }, [editValue, translatedText, confirmedText, editSaving])

  const handleEditCancel = useCallback(() => {
    setIsEditing(false)
    setEditValue('')
  }, [])

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleEditSave()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      handleEditCancel()
    }
  }, [handleEditSave, handleEditCancel])

  // Resolve display values based on accessibility settings
  const effectiveFontSize = a11y.highContrast ? Math.max(config.fontSize + 4, 34) : config.fontSize
  const translatedFontSize = Math.max(effectiveFontSize - 2, 16)
  const hasContent = confirmedText || interimText

  const effectiveSourceColor = a11y.highContrast ? '#ffffff' : config.sourceTextColor
  const effectiveTranslatedColor = a11y.highContrast ? '#ffff00' : config.translatedTextColor
  const effectiveBgOpacity = a11y.highContrast ? 100 : config.backgroundOpacity
  const effectiveTextShadow = '0 2px 4px rgba(0,0,0,0.8)'
  const effectiveFontFamily = a11y.dyslexiaFont ? DYSLEXIA_FONT_FAMILY : BASE_FONT_FAMILY

  // Transition: instant for reduced motion, normal otherwise
  const fadeOutTransition = a11y.reducedMotion ? 'none' : `opacity ${FADE_OUT_MS}ms ease-out`
  const fadeInTransition = a11y.reducedMotion ? 'none' : 'opacity 0.15s ease-out'

  // WCAG 1.4.12 spacing
  const spacingStyle: React.CSSProperties = {
    letterSpacing: a11y.letterSpacing ? `${a11y.letterSpacing}em` : undefined,
    wordSpacing: a11y.wordSpacing ? `${a11y.wordSpacing}em` : undefined
  }

  return (
    <div
      role="region"
      aria-label="Subtitles"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: config.position === 'top' ? 'flex-start' : 'flex-end',
        padding: '1rem clamp(1rem, 5%, 3rem)',
        fontFamily: effectiveFontFamily,
        userSelect: isEditMode ? 'auto' : 'none'
      }}
    >
      {/* Edit mode indicator (#590) */}
      {isEditMode && !isDragMode && (
        <div style={{
          position: 'fixed',
          top: '4px',
          right: '8px',
          zIndex: 9999,
          pointerEvents: 'none'
        }}>
          <span style={{
            color: '#fbbf24',
            fontSize: '11px',
            fontWeight: 600,
            background: 'rgba(0,0,0,0.6)',
            padding: '3px 8px',
            borderRadius: '4px'
          }}>
            Edit Mode
          </span>
        </div>
      )}

      {/* Drag handle overlay */}
      {isDragMode && (
        <div
          onMouseDown={handleDragMouseDown}
          style={{
            position: 'fixed',
            inset: 0,
            cursor: 'move',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(59, 130, 246, 0.08)',
            border: '2px dashed rgba(96, 165, 250, 0.5)',
            borderRadius: '0.625rem'
          }}
        >
          <span style={{
            color: '#60a5fa',
            fontSize: '14px',
            fontWeight: 600,
            background: 'rgba(0,0,0,0.6)',
            padding: '6px 16px',
            borderRadius: '6px',
            pointerEvents: 'none'
          }}>
            Drag to reposition
          </span>
        </div>
      )}

      {/* Single subtitle slot */}
      <div
        style={{
          background: `rgba(0, 0, 0, ${effectiveBgOpacity / 100})`,
          borderRadius: a11y.highContrast ? '0' : '0.625rem',
          padding: '0.625rem 1.25rem',
          backdropFilter: a11y.highContrast ? 'none' : 'blur(8px)',
          WebkitBackdropFilter: a11y.highContrast ? 'none' : 'blur(8px)',
          opacity: visible && hasContent ? 1 : 0,
          transition: visible ? fadeInTransition : fadeOutTransition,
          pointerEvents: visible ? 'auto' : 'none',
          textAlign: 'center'
        }}
      >
        {/* Speaker label from diarization (#549) */}
        {speakerLabel && (
          <div
            style={{
              fontSize: `${Math.max(effectiveFontSize - 8, 12)}px`,
              fontWeight: 700,
              color: SPEAKER_COLORS[speakerIndex % SPEAKER_COLORS.length],
              textShadow: effectiveTextShadow,
              marginBottom: '2px',
              textAlign: 'left'
            }}
          >
            {speakerLabel}
          </div>
        )}

        {/* Source text: confirmed (stable) + interim (dimmed, still changing) */}
        <div
          aria-live="polite"
          style={{
            fontSize: `${effectiveFontSize}px`,
            fontWeight: 600,
            lineHeight: 1.5,
            textShadow: effectiveTextShadow,
            overflow: 'hidden',
            wordBreak: 'break-word',
            ...spacingStyle
          }}
        >
          <span style={{ color: speakerLabel ? SPEAKER_COLORS[speakerIndex % SPEAKER_COLORS.length] : effectiveSourceColor }}>{confirmedText}</span>
          {interimText && (
            <span style={{ color: a11y.highContrast ? 'rgba(255,255,255,0.7)' : INTERIM_TEXT_COLOR }}>{interimText}</span>
          )}
        </div>

        {/* Translation: only updates on finalized results — assertive for screen readers */}
        {translatedText && !isEditing && (
          <div
            aria-live="assertive"
            role={isEditMode ? 'button' : undefined}
            tabIndex={isEditMode ? 0 : undefined}
            onClick={handleTranslationClick}
            onKeyDown={isEditMode ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                handleTranslationClick()
              }
            } : undefined}
            style={{
              color: effectiveTranslatedColor,
              fontSize: `${translatedFontSize}px`,
              fontWeight: 600,
              lineHeight: 1.5,
              marginTop: '0.25rem',
              textShadow: effectiveTextShadow,
              wordBreak: 'break-word',
              cursor: isEditMode ? 'text' : 'default',
              borderBottom: isEditMode ? '1px dashed rgba(255,255,255,0.3)' : 'none',
              paddingBottom: isEditMode ? '2px' : 0,
              ...spacingStyle
            }}
          >
            {config.showConfidenceIndicator ? (
              <ConfidenceText
                text={translatedText}
                confidence={confidence}
                tokenConfidences={tokenConfidences}
                color={effectiveTranslatedColor}
                highContrast={a11y.highContrast}
              />
            ) : (
              translatedText
            )}
          </div>
        )}

        {/* Inline edit input (#590) */}
        {isEditing && (
          <div style={{ marginTop: '0.25rem', display: 'flex', gap: '4px', alignItems: 'center' }}>
            <input
              ref={editInputRef}
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleEditKeyDown}
              aria-label="Correct translation"
              style={{
                flex: 1,
                background: 'rgba(0,0,0,0.6)',
                color: effectiveTranslatedColor,
                fontSize: `${translatedFontSize}px`,
                fontWeight: 600,
                fontFamily: effectiveFontFamily,
                border: `1px solid ${effectiveTranslatedColor}`,
                borderRadius: '4px',
                padding: '2px 6px',
                outline: '2px solid transparent',
                textShadow: effectiveTextShadow
              }}
            />
            <button
              onClick={handleEditSave}
              disabled={editSaving || !editValue.trim() || editValue.trim() === translatedText}
              aria-label="Save correction"
              style={{
                background: '#22c55e',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                padding: '8px 16px',
                minHeight: '44px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer',
                opacity: editSaving ? 0.5 : 1
              }}
            >
              {editSaving ? '...' : 'Save'}
            </button>
            <button
              onClick={handleEditCancel}
              aria-label="Cancel edit"
              style={{
                background: '#64748b',
                color: '#fff',
                border: 'none',
                borderRadius: '4px',
                padding: '8px 16px',
                minHeight: '44px',
                fontSize: '12px',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Esc
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default SubtitleOverlay
