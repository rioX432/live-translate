import type { TranslatorEngine, Language } from '../types'
import { apiFetch, apiInitialize, DEFAULT_TIMEOUT_MS } from './api-utils'

const MS_TRANSLATE_URL = 'https://api.cognitive.microsofttranslator.com/translate'
const API_VERSION = '3.0'

const ERROR_MAPPINGS = [
  { statuses: [401], message: 'Invalid API key or region' },
  { statuses: [429], message: 'Rate limit exceeded' }
]

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
    if (!this.region) {
      throw new Error('Microsoft Translator region is required')
    }
    const alreadyInit = await apiInitialize({
      initialized: this.initialized,
      apiKey: this.apiKey,
      keyName: 'Microsoft Translator API key',
      serviceName: 'Microsoft Translator',
      testTranslate: () => this.translate('test', 'en', 'ja')
    })
    if (!alreadyInit) this.initialized = true
  }

  async translate(text: string, from: Language, to: Language): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text

    const params = new URLSearchParams({
      'api-version': API_VERSION,
      from,
      to
    })

    const data = await apiFetch<Array<{ translations: Array<{ text: string; to: string }> }>>({
      url: `${MS_TRANSLATE_URL}?${params}`,
      init: {
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': this.apiKey,
          'Ocp-Apim-Subscription-Region': this.region,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{ text }])
      },
      timeoutMs: this.timeoutMs,
      serviceName: 'Microsoft Translator',
      errorMappings: ERROR_MAPPINGS
    })

    return data[0]?.translations[0]?.text || ''
  }

  async dispose(): Promise<void> {
    console.log('[microsoft-translate] Disposing resources')
  }
}
