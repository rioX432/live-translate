import { useEffect, useState } from 'react'

interface SubtitleLine {
  id: number
  sourceText: string
  translatedText: string
  sourceLanguage: string
  timestamp: number
}

function SubtitleOverlay(): JSX.Element {
  const [lines, setLines] = useState<SubtitleLine[]>([])

  useEffect(() => {
    window.api.onTranslationResult((data) => {
      const result = data as SubtitleLine
      setLines((prev) => {
        const updated = [...prev, { ...result, id: Date.now() }]
        // Keep last 3 lines
        return updated.slice(-3)
      })
    })
  }, [])

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        padding: '16px 32px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        userSelect: 'none',
        WebkitAppRegion: 'no-drag' as unknown as string
      }}
    >
      {lines.map((line) => (
        <div
          key={line.id}
          style={{
            background: 'rgba(0, 0, 0, 0.75)',
            borderRadius: '8px',
            padding: '8px 16px',
            marginBottom: '4px'
          }}
        >
          <div
            style={{
              color: '#4ade80',
              fontSize: '28px',
              fontWeight: 600,
              lineHeight: 1.3
            }}
          >
            {line.sourceText}
          </div>
          <div
            style={{
              color: '#60a5fa',
              fontSize: '28px',
              fontWeight: 600,
              lineHeight: 1.3
            }}
          >
            {line.translatedText}
          </div>
        </div>
      ))}
    </div>
  )
}

export default SubtitleOverlay
