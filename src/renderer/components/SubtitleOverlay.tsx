import { useEffect, useRef, useState } from 'react'

interface SubtitleLine {
  id: number
  sourceText: string
  translatedText: string
  sourceLanguage: string
  timestamp: number
  opacity: number
  isInterim?: boolean
}

const MAX_LINES = 3
const FADE_DURATION_MS = 8000
const INTERIM_LINE_ID = -1

function SubtitleOverlay(): JSX.Element {
  const [lines, setLines] = useState<SubtitleLine[]>([])
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    // Final (confirmed) results — add as permanent line
    const unsubscribeResult = window.api.onTranslationResult((data) => {
      const result = data as Omit<SubtitleLine, 'id' | 'opacity'>
      setLines((prev) => {
        // Remove any interim line, add the final result
        const withoutInterim = prev.filter((l) => l.id !== INTERIM_LINE_ID)
        const updated = [...withoutInterim, { ...result, id: Date.now(), opacity: 1 }]
        return updated.slice(-MAX_LINES)
      })
    })

    // Interim (streaming) results — replace the interim line in place
    window.api.onInterimResult((data) => {
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

    // Fade old lines
    fadeTimerRef.current = setInterval(() => {
      setLines((prev) =>
        prev
          .map((line) => {
            // Don't fade interim lines
            if (line.isInterim) return line
            const age = Date.now() - line.timestamp
            if (age > FADE_DURATION_MS) {
              return { ...line, opacity: Math.max(0, 1 - (age - FADE_DURATION_MS) / 2000) }
            }
            return line
          })
          .filter((line) => line.opacity > 0)
      )
    }, 500)

    return () => {
      unsubscribeResult?.()
      if (fadeTimerRef.current) clearInterval(fadeTimerRef.current)
    }
  }, [])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
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
            background: line.isInterim ? 'rgba(0, 0, 0, 0.65)' : 'rgba(0, 0, 0, 0.78)',
            borderRadius: '10px',
            padding: '10px 20px',
            marginBottom: '6px',
            opacity: line.opacity,
            transition: 'opacity 0.5s ease-out',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            borderLeft: `4px solid ${
              line.isInterim
                ? '#94a3b8'
                : line.sourceLanguage === 'ja'
                  ? '#4ade80'
                  : '#60a5fa'
            }`
          }}
        >
          <div
            style={{
              color: line.isInterim ? '#cbd5e1' : '#f0f0f0',
              fontSize: '30px',
              fontWeight: 600,
              lineHeight: 1.4,
              textShadow: '0 1px 3px rgba(0,0,0,0.5)',
              fontStyle: line.isInterim ? 'italic' : 'normal'
            }}
          >
            {line.sourceText}
          </div>
          {line.translatedText && (
            <div
              style={{
                color: line.isInterim
                  ? '#94a3b8'
                  : line.sourceLanguage === 'ja'
                    ? '#93c5fd'
                    : '#86efac',
                fontSize: '28px',
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
