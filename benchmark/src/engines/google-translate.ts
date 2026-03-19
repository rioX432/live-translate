import type { BenchmarkEngine, Direction } from '../types.js'

const GOOGLE_TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2'
const TIMEOUT_MS = 15_000

export class GoogleTranslateBench implements BenchmarkEngine {
  readonly id = 'google'
  readonly label = 'Google Translate'

  private apiKey: string

  constructor() {
    const key = process.env.GOOGLE_TRANSLATE_API_KEY
    if (!key) {
      throw new Error('GOOGLE_TRANSLATE_API_KEY environment variable is required')
    }
    this.apiKey = key
  }

  async initialize(): Promise<void> {
    // Validate with a test request
    await this.translate('test', 'en-ja')
  }

  async translate(text: string, direction: Direction): Promise<string> {
    if (!text.trim()) return ''

    const [from, to] = direction.split('-') as [string, string]
    const params = new URLSearchParams({
      q: text,
      source: from,
      target: to,
      key: this.apiKey,
      format: 'text'
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(`${GOOGLE_TRANSLATE_URL}?${params}`, {
        method: 'POST',
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`Google Translation API error: ${response.status}`)
      }

      const data = (await response.json()) as {
        data: { translations: Array<{ translatedText: string }> }
      }
      return data.data.translations[0]?.translatedText || ''
    } finally {
      clearTimeout(timeout)
    }
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }
}
