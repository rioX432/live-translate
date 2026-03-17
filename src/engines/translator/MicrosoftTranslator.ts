import type { TranslatorEngine, Language } from '../types'

const MS_TRANSLATE_URL = 'https://api.cognitive.microsofttranslator.com/translate'
const API_VERSION = '3.0'

export class MicrosoftTranslator implements TranslatorEngine {
  readonly id = 'microsoft-translate'
  readonly name = 'Microsoft Translator'
  readonly isOffline = false

  private apiKey: string
  private region: string

  constructor(apiKey: string, region: string) {
    this.apiKey = apiKey
    this.region = region
  }

  async initialize(): Promise<void> {
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
      throw new Error(`Invalid Microsoft Translator credentials: ${err}`)
    }
  }

  async translate(text: string, from: Language, to: Language): Promise<string> {
    if (!text.trim()) return ''

    const params = new URLSearchParams({
      'api-version': API_VERSION,
      from,
      to
    })

    const response = await fetch(`${MS_TRANSLATE_URL}?${params}`, {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': this.apiKey,
        'Ocp-Apim-Subscription-Region': this.region,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify([{ text }])
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

    const data = (await response.json()) as Array<{
      translations: Array<{ text: string; to: string }>
    }>

    return data[0]?.translations[0]?.text || ''
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }
}
