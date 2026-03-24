import type { BenchmarkEngine, Direction } from '../types.js'

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'
const TIMEOUT_MS = 15_000

const LANG_MAP: Record<string, string> = {
  ja: 'Japanese',
  en: 'English'
}

export class GeminiBench implements BenchmarkEngine {
  readonly id = 'gemini'
  readonly label = 'Gemini 2.5 Flash'

  private apiKey: string

  constructor() {
    const key = process.env.GEMINI_API_KEY
    if (!key) {
      throw new Error('GEMINI_API_KEY environment variable is required')
    }
    this.apiKey = key
  }

  async initialize(): Promise<void> {
    // API key validation deferred to first real translation to avoid wasting tokens
  }

  async translate(text: string, direction: Direction): Promise<string> {
    if (!text.trim()) return ''

    const [fromCode, toCode] = direction.split('-') as [string, string]
    const fromLang = LANG_MAP[fromCode] ?? fromCode
    const toLang = LANG_MAP[toCode] ?? toCode

    const prompt = `Translate the following ${fromLang} text to ${toLang}. Output ONLY the translated text, nothing else.\n\n${text}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(GEMINI_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 256
          }
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`Gemini API error: ${response.status}`)
      }

      const data = (await response.json()) as {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> }
        }>
      }
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
    } finally {
      clearTimeout(timeout)
    }
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }
}
