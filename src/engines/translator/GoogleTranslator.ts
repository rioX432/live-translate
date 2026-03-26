import type { TranslatorEngine, Language } from '../types'
import { apiFetch, apiInitialize, DEFAULT_TIMEOUT_MS } from './api-utils'

const GOOGLE_TRANSLATE_URL = 'https://translation.googleapis.com/language/translate/v2'

const ERROR_MAPPINGS = [
  { statuses: [403], message: 'Invalid or expired API key' },
  { statuses: [429], message: 'Rate limit exceeded' }
]

export class GoogleTranslator implements TranslatorEngine {
  readonly id = 'google-translate'
  readonly name = 'Google Cloud Translation'
  readonly isOffline = false

  private apiKey: string
  private timeoutMs: number
  private initialized = false

  constructor(apiKey: string, options?: { timeoutMs?: number }) {
    this.apiKey = apiKey
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async initialize(): Promise<void> {
    const alreadyInit = await apiInitialize({
      initialized: this.initialized,
      apiKey: this.apiKey,
      keyName: 'Google Cloud Translation API key',
      serviceName: 'Google Translation API',
      testTranslate: () => this.translate('test', 'en', 'ja')
    })
    if (!alreadyInit) this.initialized = true
  }

  async translate(text: string, from: Language, to: Language): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text

    const params = new URLSearchParams({
      q: text,
      source: from,
      target: to,
      key: this.apiKey,
      format: 'text'
    })

    const data = await apiFetch<{ data: { translations: Array<{ translatedText: string }> } }>({
      url: `${GOOGLE_TRANSLATE_URL}?${params}`,
      init: { method: 'POST' },
      timeoutMs: this.timeoutMs,
      serviceName: 'Google Translation API',
      errorMappings: ERROR_MAPPINGS
    })

    return data.data.translations[0]?.translatedText || ''
  }

  async dispose(): Promise<void> {
    console.log('[google-translate] Disposing resources')
  }
}
