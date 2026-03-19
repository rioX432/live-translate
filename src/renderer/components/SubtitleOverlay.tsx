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

interface SubtitleConfig {
  fontSize: number
  sourceTextColor: string
  translatedTextColor: string
  backgroundOpacity: number
  position: 'top' | 'bottom'
}

const DEFAULT_CONFIG: SubtitleConfig = {
  fontSize: 30,
  sourceTextColor: '#f0f0f0',
  translatedTextColor: '#93c5fd',
  backgroundOpacity: 78,
  position: 'bottom'
}

const MAX_LINES = 3
const FADE_DURATION_MS = 8000
const INTERIM_LINE_ID = -1
let nextLineId = 1

function SubtitleOverlay(): JSX.Element {
  const [lines, setLines] = useState<SubtitleLine[]>([])
  const [config, setConfig] = useState<SubtitleConfig>(DEFAULT_CONFIG)
  const fadeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
        // Remove any interim line, add the final result
        const withoutInterim = prev.filter((l) => l.id !== INTERIM_LINE_ID)
        const updated = [...withoutInterim, { ...result, id: nextLineId++, opacity: 1 }]
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
      unsubscribeInterim?.()
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
            background: line.isInterim
              ? `rgba(0, 0, 0, ${Math.max(0, config.backgroundOpacity - 13) / 100})`
              : `rgba(0, 0, 0, ${config.backgroundOpacity / 100})`,
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
              color: line.isInterim ? '#cbd5e1' : config.sourceTextColor,
              fontSize: `${config.fontSize}px`,
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
                color: line.isInterim ? '#94a3b8' : config.translatedTextColor,
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
