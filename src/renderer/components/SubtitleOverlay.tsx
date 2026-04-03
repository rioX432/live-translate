import React, { useCallback, useEffect, useRef, useState } from 'react'

interface SubtitleConfig {
  fontSize: number
  sourceTextColor: string
  translatedTextColor: string
  backgroundOpacity: number
  position: 'top' | 'bottom'
}

const DEFAULT_CONFIG: SubtitleConfig = {
  fontSize: 30,
  sourceTextColor: '#ffffff',
  translatedTextColor: '#7dd3fc',
  backgroundOpacity: 78,
  position: 'bottom'
}

/** Silence timeout before subtitle fades out */
const SILENCE_TIMEOUT_MS = 4000
/** Fade-out transition duration */
const FADE_OUT_MS = 800

/** Dimmed color for interim (unconfirmed) text */
const INTERIM_TEXT_COLOR = 'rgba(255, 255, 255, 0.5)'

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
        setConfig((prev) => ({ ...prev, ...s.subtitleSettings as Partial<SubtitleConfig> }))
      }
    })

    const unsubscribe = window.api.onSubtitleSettingsChanged((settings) => {
      setConfig((prev) => ({ ...prev, ...settings as Partial<SubtitleConfig> }))
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

  const translatedFontSize = Math.max(config.fontSize - 2, 16)
  const hasContent = confirmedText || interimText

  return (
    <div
      role="region"
      aria-live="polite"
      aria-label="Subtitles"
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: config.position === 'top' ? 'flex-start' : 'flex-end',
        padding: '1rem clamp(1rem, 5%, 3rem)',
        fontFamily:
          '"Hiragino Sans", "Hiragino Kaku Gothic ProN", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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
          background: `rgba(0, 0, 0, ${config.backgroundOpacity / 100})`,
          borderRadius: '0.625rem',
          padding: '0.625rem 1.25rem',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          opacity: visible && hasContent ? 1 : 0,
          transition: `opacity ${visible ? '0.15s' : `${FADE_OUT_MS}ms`} ease-out`,
          pointerEvents: visible ? 'auto' : 'none',
          textAlign: 'center'
        }}
      >
        {/* Source text: confirmed (stable) + interim (dimmed, still changing) */}
        <div
          style={{
            fontSize: `${config.fontSize}px`,
            fontWeight: 600,
            lineHeight: 1.4,
            textShadow: '0 1px 3px rgba(0,0,0,0.5)'
          }}
        >
          <span style={{ color: config.sourceTextColor }}>{confirmedText}</span>
          {interimText && (
            <span style={{ color: INTERIM_TEXT_COLOR }}>{interimText}</span>
          )}
        </div>

        {/* Translation: only updates on finalized results */}
        {translatedText && (
          <div
            style={{
              color: config.translatedTextColor,
              fontSize: `${translatedFontSize}px`,
              fontWeight: 600,
              lineHeight: 1.4,
              marginTop: '0.25rem',
              textShadow: '0 1px 3px rgba(0,0,0,0.5)'
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
