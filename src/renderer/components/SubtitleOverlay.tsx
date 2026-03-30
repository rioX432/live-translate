import React, { useCallback, useEffect, useRef, useState } from 'react'

/** Default 8-color palette for speaker identification — must match SpeakerTracker.ts */
const SPEAKER_COLORS = [
  '#60a5fa', '#4ade80', '#f472b6', '#facc15',
  '#a78bfa', '#fb923c', '#2dd4bf', '#f87171'
]

/** Map a speakerId string (e.g. "Speaker A") to its palette color */
function getSpeakerColor(speakerId: string): string | undefined {
  const match = speakerId.match(/^Speaker ([A-H])$/)
  if (!match) return undefined
  const idx = match[1]!.charCodeAt(0) - 'A'.charCodeAt(0)
  return SPEAKER_COLORS[idx]
}

interface SubtitleLine {
  id: number
  sourceText: string
  translatedText: string
  sourceLanguage: string
  timestamp: number
  opacity: number
  isInterim?: boolean
  speakerId?: string
  /** Whether this line is a draft from hybrid translation, pending refinement */
  isDraft?: boolean
  /** STT confidence score (0.0–1.0) for confidence-based styling */
  confidence?: number
}

interface SubtitleConfig {
  fontSize: number
  sourceTextColor: string
  translatedTextColor: string
  backgroundOpacity: number
  position: 'top' | 'bottom'
  showConfidenceIndicator: boolean
}

const DEFAULT_CONFIG: SubtitleConfig = {
  fontSize: 30,
  sourceTextColor: '#ffffff',
  translatedTextColor: '#7dd3fc',
  backgroundOpacity: 78,
  position: 'bottom',
  showConfidenceIndicator: true
}

const MAX_LINES = 3
const FADE_DURATION_MS = 8000
const INTERIM_LINE_ID = -1
const DRAFT_LINE_ID = -2

/** Compute opacity and fontStyle overrides based on STT confidence level */
function getConfidenceStyle(
  confidence: number | undefined,
  enabled: boolean
): { opacity: number; fontStyle: 'normal' | 'italic' } {
  if (!enabled || confidence === undefined) return { opacity: 1, fontStyle: 'normal' }
  if (confidence >= 0.9) return { opacity: 1, fontStyle: 'normal' }
  if (confidence >= 0.5) return { opacity: 0.8, fontStyle: 'normal' }
  return { opacity: 0.5, fontStyle: 'italic' }
}

function SubtitleOverlay(): React.JSX.Element {
  const [lines, setLines] = useState<SubtitleLine[]>([])
  const [config, setConfig] = useState<SubtitleConfig>(DEFAULT_CONFIG)
  const [isDragMode, setIsDragMode] = useState(false)
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const nextLineIdRef = useRef(1)
  const isDraggingRef = useRef(false)
  const dragStartRef = useRef({ screenX: 0, screenY: 0 })

  // Drag handlers — move the entire subtitle window by delta
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
      if (typeof s.showConfidenceIndicator === 'boolean') {
        setConfig((prev) => ({ ...prev, showConfidenceIndicator: s.showConfidenceIndicator as boolean }))
      }
    })

    const unsubscribe = window.api.onSubtitleSettingsChanged((settings) => {
      setConfig((prev) => ({ ...prev, ...settings as Partial<SubtitleConfig> }))
    })

    // Listen for drag mode toggle from main process
    const unsubDrag = window.api.onDragModeChanged?.((enabled: boolean) => {
      setIsDragMode(enabled)
    })

    return () => {
      unsubscribe?.()
      unsubDrag?.()
    }
  }, [])

  useEffect(() => {
    // Final (confirmed) results — add as permanent line
    const unsubscribeResult = window.api.onTranslationResult((data) => {
      const result = data as Omit<SubtitleLine, 'id' | 'opacity'>
      setLines((prev) => {
        // Remove any interim or draft line, add the final result
        const cleaned = prev.filter((l) => l.id !== INTERIM_LINE_ID && l.id !== DRAFT_LINE_ID)
        if (nextLineIdRef.current >= Number.MAX_SAFE_INTEGER - 1000) {
          nextLineIdRef.current = 1
        }
        const updated = [...cleaned, { ...result, id: nextLineIdRef.current++, opacity: 1 }]
        return updated.slice(-MAX_LINES)
      })
    })

    // Interim (streaming) results — replace the interim line in place
    const unsubscribeInterim = window.api.onInterimResult((data) => {
      const result = data as Omit<SubtitleLine, 'id' | 'opacity' | 'isInterim'>
      setLines((prev) => {
        const withoutInterim = prev.filter((l) => l.id !== INTERIM_LINE_ID)
        const interimLine: SubtitleLine = {
          ...result,
          id: INTERIM_LINE_ID,
          opacity: 1,
          isInterim: true
        }
        const updated = [...withoutInterim, interimLine]
        return updated.slice(-MAX_LINES)
      })
    })

    // Draft results from hybrid translation (#235) — show immediately with dimmed style
    const unsubscribeDraft = window.api.onDraftResult((data) => {
      const result = data as Omit<SubtitleLine, 'id' | 'opacity' | 'isDraft'>
      setLines((prev) => {
        const withoutDraft = prev.filter((l) => l.id !== DRAFT_LINE_ID)
        const draftLine: SubtitleLine = {
          ...result,
          id: DRAFT_LINE_ID,
          opacity: 1,
          isDraft: true
        }
        const updated = [...withoutDraft, draftLine]
        return updated.slice(-MAX_LINES)
      })
    })

    // Fade old lines
    fadeTimerRef.current = setInterval(() => {
      setLines((prev) => {
        if (prev.length === 0) return prev
        return prev
          .map((line) => {
            // Don't fade interim or draft lines
            if (line.isInterim || line.isDraft) return line
            const age = Date.now() - line.timestamp
            if (age > FADE_DURATION_MS) {
              return { ...line, opacity: Math.max(0, 1 - (age - FADE_DURATION_MS) / 2000) }
            }
            return line
          })
          .filter((line) => line.opacity > 0)
      })
    }, 500)

    return () => {
      unsubscribeResult?.()
      unsubscribeInterim?.()
      unsubscribeDraft?.()
      if (fadeTimerRef.current) clearInterval(fadeTimerRef.current)
    }
  }, [])

  const translatedFontSize = Math.max(config.fontSize - 2, 16)

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
      {/* Drag handle overlay — visible only in drag mode */}
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
      {lines.map((line) => {
        const confStyle = getConfidenceStyle(line.confidence, config.showConfidenceIndicator)
        return (
          <div
            key={line.id}
            style={{
              background: (line.isInterim || line.isDraft)
                ? `rgba(0, 0, 0, ${Math.max(0, config.backgroundOpacity - 13) / 100})`
                : `rgba(0, 0, 0, ${config.backgroundOpacity / 100})`,
              borderRadius: '0.625rem',
              padding: '0.625rem 1.25rem',
              marginBottom: '0.375rem',
              opacity: line.opacity,
              transition: 'opacity 0.3s ease-out',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
              borderLeft: `0.25rem solid ${
                line.isInterim
                  ? '#94a3b8'
                  : line.isDraft
                    ? '#f59e0b'
                    : (line.speakerId && getSpeakerColor(line.speakerId))
                      || (line.sourceLanguage === 'ja' ? '#4ade80' : '#60a5fa')
              }`
            }}
          >
            <div
              style={{
                color: line.isInterim ? '#cbd5e1' : line.isDraft ? '#d4d4d8' : config.sourceTextColor,
                fontSize: `${config.fontSize}px`,
                fontWeight: 600,
                lineHeight: 1.4,
                textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                fontStyle: line.isInterim || line.isDraft ? 'italic' : confStyle.fontStyle,
                opacity: line.isDraft ? 0.85 : confStyle.opacity
              }}
            >
              {line.speakerId && (
                <span style={{
                  fontSize: '0.7em',
                  opacity: 0.85,
                  marginRight: '0.5rem',
                  maxWidth: '7.5rem',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'inline-block',
                  verticalAlign: 'middle',
                  color: getSpeakerColor(line.speakerId) || 'inherit'
                }}>
                  [{line.speakerId}]
                </span>
              )}
              {line.sourceText}
            </div>
            {line.translatedText && (
              <div
                style={{
                  color: line.isInterim ? '#94a3b8' : line.isDraft ? '#b4b4bb' : config.translatedTextColor,
                  fontSize: `${translatedFontSize}px`,
                  fontWeight: 600,
                  lineHeight: 1.4,
                  marginTop: '0.125rem',
                  textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                  fontStyle: line.isInterim || line.isDraft ? 'italic' : confStyle.fontStyle,
                  opacity: line.isDraft ? 0.85 : confStyle.opacity
                }}
              >
                {line.translatedText}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default SubtitleOverlay
