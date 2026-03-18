import type { TranslatorEngine, Language } from '../types'

const GOOGLE_TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2'

export class GoogleTranslator implements TranslatorEngine {
  readonly id = 'google-translate'
  readonly name = 'Google Cloud Translation'
  readonly isOffline = false

  private apiKey: string
  private initialized = false

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (!this.apiKey) {
      throw new Error('Google Cloud Translation API key is required')
    }
    // Validate API key with a test request
    try {
      await this.translate('test', 'en', 'ja')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Invalid Google Translation API key: ${msg}`)
    }
    this.initialized = true
  }

  async translate(text: string, from: Language, to: Language): Promise<string> {
    if (!text.trim()) return ''

    const params = new URLSearchParams({
      q: text,
      source: from,
      target: to,
      key: this.apiKey,
      format: 'text'
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    try {
      const response = await fetch(`${GOOGLE_TRANSLATE_URL}?${params}`, {
        method: 'POST',
        signal: controller.signal
      })

      if (!response.ok) {
        if (response.status === 403) {
          throw new Error('Google Translation API: Invalid or expired API key')
        }
        if (response.status === 429) {
          throw new Error('Google Translation API: Rate limit exceeded')
        }
        throw new Error(`Google Translation API error: ${response.status}`)
      }

      let data: { data: { translations: Array<{ translatedText: string }> } }
      try {
        data = (await response.json()) as typeof data
      } catch {
        throw new Error('Google Translation API: Invalid JSON response')
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
