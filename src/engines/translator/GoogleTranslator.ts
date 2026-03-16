import type { TranslatorEngine, Language } from '../types'

const GOOGLE_TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2'

export class GoogleTranslator implements TranslatorEngine {
  readonly id = 'google-translate'
  readonly name = 'Google Cloud Translation'
  readonly isOffline = false

  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('Google Cloud Translation API key is required')
    }
    // Validate API key with a test request
    try {
      await this.translate('test', 'en', 'ja')
    } catch (err) {
      throw new Error(`Invalid Google Translation API key: ${err}`)
    }
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

    const response = await fetch(`${GOOGLE_TRANSLATE_URL}?${params}`, {
      method: 'POST'
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

    const data = (await response.json()) as {
      data: { translations: Array<{ translatedText: string }> }
    }

    return data.data.translations[0]?.translatedText || ''
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }
}
