import type { TranslatorEngine, Language } from '../types'

const DEEPL_API_URL = 'https://api-free.deepl.com/v2/translate'

const LANG_MAP: Record<Language, { source: string; target: string }> = {
  ja: { source: 'JA', target: 'JA' },
  en: { source: 'EN', target: 'EN-US' }
}

export class DeepLTranslator implements TranslatorEngine {
  readonly id = 'deepl-translate'
  readonly name = 'DeepL Translate'
  readonly isOffline = false

  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async initialize(): Promise<void> {
    if (!this.apiKey) {
      throw new Error('DeepL API key is required')
    }
    // Validate API key with a test request
    try {
      await this.translate('test', 'en', 'ja')
    } catch (err) {
      throw new Error(`Invalid DeepL API key: ${err}`)
    }
  }

  async translate(text: string, from: Language, to: Language): Promise<string> {
    if (!text.trim()) return ''

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    try {
      const response = await fetch(DEEPL_API_URL, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: [text],
          source_lang: LANG_MAP[from].source,
          target_lang: LANG_MAP[to].target
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
          throw new Error('DeepL API: Invalid or expired API key')
        }
        if (response.status === 429) {
          throw new Error('DeepL API: Rate limit exceeded')
        }
        if (response.status === 456) {
          throw new Error('DeepL API: Quota exceeded')
        }
        throw new Error(`DeepL API error: ${response.status}`)
      }

      let data: { translations: Array<{ text: string; detected_source_language: string }> }
      try {
        data = (await response.json()) as typeof data
      } catch {
        throw new Error('DeepL API: Invalid JSON response')
      }

      return data.translations[0]?.text || ''
    } finally {
      clearTimeout(timeout)
    }
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }
}
