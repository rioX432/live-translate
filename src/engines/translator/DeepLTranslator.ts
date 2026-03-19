import type { TranslatorEngine, Language } from '../types'

const DEEPL_FREE_URL = 'https://api-free.deepl.com/v2/translate'
const DEEPL_PRO_URL = 'https://api.deepl.com/v2/translate'
const DEFAULT_TIMEOUT_MS = 15_000

const LANG_MAP: Record<Language, { source: string; target: string }> = {
  ja: { source: 'JA', target: 'JA' },
  en: { source: 'EN', target: 'EN-US' }
}

export class DeepLTranslator implements TranslatorEngine {
  readonly id = 'deepl-translate'
  readonly name = 'DeepL Translate'
  readonly isOffline = false

  private apiKey: string
  private apiUrl: string
  private timeoutMs: number
  private initialized = false

  constructor(apiKey: string, options?: { timeoutMs?: number }) {
    this.apiKey = apiKey
    this.apiUrl = apiKey.endsWith(':fx') ? DEEPL_FREE_URL : DEEPL_PRO_URL
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (!this.apiKey) {
      throw new Error('DeepL API key is required')
    }
    // Validate API key with a test request
    try {
      await this.translate('test', 'en', 'ja')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Invalid DeepL API key: ${msg}`)
    }
    this.initialized = true
  }

  async translate(text: string, from: Language, to: Language): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(this.apiUrl, {
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
    console.log('[deepl] Disposing resources')
  }
}
