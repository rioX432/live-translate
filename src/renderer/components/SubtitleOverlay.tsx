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
}

const DEFAULT_CONFIG: SubtitleConfig = {
  fontSize: 30,
  sourceTextColor: '#ffffff',
  translatedTextColor: '#7dd3fc',
  backgroundOpacity: 78,
  position: 'bottom',
  accessibility: DEFAULT_ACCESSIBILITY
}

/** Silence timeout before subtitle fades out */
const SILENCE_TIMEOUT_MS = 4000
/** Fade-out transition duration */
const FADE_OUT_MS = 800

/** Dimmed color for interim (unconfirmed) text */
const INTERIM_TEXT_COLOR = 'rgba(255, 255, 255, 0.5)'

/** Font stack with Noto Sans CJK for broader coverage */
const BASE_FONT_FAMILY =
  '"Noto Sans", "Noto Sans CJK JP", "Hiragino Sans", "Hiragino Kaku Gothic ProN", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

/** Dyslexia-friendly font stack */
const DYSLEXIA_FONT_FAMILY =
  '"Atkinson Hyperlegible", "Noto Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'

interface ResultData {
  sourceText: string
  translatedText: string
  confirmedText?: string
  interimText?: string
}

function SubtitleOverlay(): React.JSX.Element {
  const [confirmedText, setConfirmedText] = useState('')
  const [interimText, setInterimText] = useState('')
  const [translatedText, setTranslatedText] = useState('')
  const [visible, setVisible] = useState(false)
  const [config, setConfig] = useState<SubtitleConfig>(DEFAULT_CONFIG)
  const [isDragMode, setIsDragMode] = useState(false)
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

    return () => {
      unsubscribe?.()
      unsubDrag?.()
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
        userSelect: 'none'
      }}
    >
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
        {/* Source text: confirmed (stable) + interim (dimmed, still changing) */}
        <div
          aria-live="polite"
          style={{
            fontSize: `${effectiveFontSize}px`,
            fontWeight: 600,
            lineHeight: 1.5,
            textShadow: effectiveTextShadow,
            ...spacingStyle
          }}
        >
          <span style={{ color: effectiveSourceColor }}>{confirmedText}</span>
          {interimText && (
            <span style={{ color: a11y.highContrast ? 'rgba(255,255,255,0.7)' : INTERIM_TEXT_COLOR }}>{interimText}</span>
          )}
        </div>

        {/* Translation: only updates on finalized results — assertive for screen readers */}
        {translatedText && (
          <div
            aria-live="assertive"
            style={{
              color: effectiveTranslatedColor,
              fontSize: `${translatedFontSize}px`,
              fontWeight: 600,
              lineHeight: 1.5,
              marginTop: '0.25rem',
              textShadow: effectiveTextShadow,
              ...spacingStyle
            }}
          >
            {translatedText}
          </div>
        )}
      </div>
    </div>
  )
}

export default SubtitleOverlay
