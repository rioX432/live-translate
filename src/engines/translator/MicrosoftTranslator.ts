import type { TranslatorEngine, Language } from '../types'

const MS_TRANSLATE_URL = 'https://api.cognitive.microsofttranslator.com/translate'
const API_VERSION = '3.0'
const DEFAULT_TIMEOUT_MS = 15_000

export class MicrosoftTranslator implements TranslatorEngine {
  readonly id = 'microsoft-translate'
  readonly name = 'Microsoft Translator'
  readonly isOffline = false

  private apiKey: string
  private region: string
  private timeoutMs: number
  private initialized = false

  constructor(apiKey: string, region: string, options?: { timeoutMs?: number }) {
    this.apiKey = apiKey
    this.region = region
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (!this.apiKey) {
      throw new Error('Microsoft Translator API key is required')
    }
    if (!this.region) {
      throw new Error('Microsoft Translator region is required')
    }
    // Validate with a test request
    try {
      await this.translate('test', 'en', 'ja')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Invalid Microsoft Translator credentials: ${msg}`)
    }
    this.initialized = true
  }

  async translate(text: string, from: Language, to: Language): Promise<string> {
    if (!text.trim()) return ''

    const params = new URLSearchParams({
      'api-version': API_VERSION,
      from,
      to
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)

    try {
      const response = await fetch(`${MS_TRANSLATE_URL}?${params}`, {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey,
          'Ocp-Apim-Subscription-Region': this.region,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{ text }]),
        signal: controller.signal
      })

      if (!response.ok) {
        if (response.status === 401) {
          throw new Error('Microsoft Translator: Invalid API key or region')
        }
        if (response.status === 429) {
          throw new Error('Microsoft Translator: Rate limit exceeded')
        }
        throw new Error(`Microsoft Translator error: ${response.status}`)
      }

      let data: Array<{ translations: Array<{ text: string; to: string }> }>
      try {
        data = (await response.json()) as typeof data
      } catch {
        throw new Error('Microsoft Translator: Invalid JSON response')
      }

      return data[0]?.translations[0]?.text || ''
    } finally {
      clearTimeout(timeout)
    }
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }
}
