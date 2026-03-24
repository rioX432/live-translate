import React, { useEffect, useRef, useState } from 'react'

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
}

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

const MAX_LINES = 3
const FADE_DURATION_MS = 8000
const INTERIM_LINE_ID = -1
const DRAFT_LINE_ID = -2

function SubtitleOverlay(): React.JSX.Element {
  const [lines, setLines] = useState<SubtitleLine[]>([])
  const [config, setConfig] = useState<SubtitleConfig>(DEFAULT_CONFIG)
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const nextLineIdRef = useRef(1)

  // Load initial settings and listen for changes
  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (s.subtitleSettings) {
        setConfig(s.subtitleSettings as SubtitleConfig)
      }
    })

    const unsubscribe = window.api.onSubtitleSettingsChanged((settings) => {
      setConfig(settings as SubtitleConfig)
    })
    return () => unsubscribe?.()
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
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: config.position === 'top' ? 'flex-start' : 'flex-end',
        padding: '16px 48px',
        fontFamily:
          '"Hiragino Sans", "Hiragino Kaku Gothic ProN", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        userSelect: 'none'
      }}
    >
      {lines.map((line) => (
        <div
          key={line.id}
          style={{
            background: (line.isInterim || line.isDraft)
              ? `rgba(0, 0, 0, ${Math.max(0, config.backgroundOpacity - 13) / 100})`
              : `rgba(0, 0, 0, ${config.backgroundOpacity / 100})`,
            borderRadius: '10px',
            padding: '10px 20px',
            marginBottom: '6px',
            opacity: line.opacity,
            transition: 'opacity 0.3s ease-out',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            borderLeft: `4px solid ${
              line.isInterim
                ? '#94a3b8'
                : line.isDraft
                  ? '#f59e0b'
                  : line.sourceLanguage === 'ja'
                    ? '#4ade80'
                    : '#60a5fa'
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
              fontStyle: line.isInterim ? 'italic' : 'normal'
            }}
          >
            {line.speakerId && (
              <span style={{ fontSize: '0.7em', opacity: 0.7, marginRight: '8px' }}>
                [{line.speakerId}]
              </span>
            )}
            {line.sourceText}
          </div>
          {line.translatedText && (
            <div
              style={{
                color: line.isInterim ? '#94a3b8' : line.isDraft ? '#a1a1aa' : config.translatedTextColor,
                fontSize: `${translatedFontSize}px`,
                fontWeight: 600,
                lineHeight: 1.4,
                marginTop: '2px',
                textShadow: '0 1px 3px rgba(0,0,0,0.5)',
                fontStyle: line.isInterim ? 'italic' : 'normal'
              }}
            >
              {line.translatedText}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export default SubtitleOverlay
