import type { BenchmarkEngine, Direction } from '../types.js'

const MS_TRANSLATE_URL = 'https://api.cognitive.microsofttranslator.com/translate'
const API_VERSION = '3.0'
const TIMEOUT_MS = 15_000

export class MicrosoftBench implements BenchmarkEngine {
  readonly id = 'microsoft'
  readonly label = 'Microsoft Translator'

  private apiKey: string
  private region: string

  constructor() {
    const key = process.env.AZURE_TRANSLATOR_KEY
    if (!key) {
      throw new Error('AZURE_TRANSLATOR_KEY environment variable is required')
    }
    const region = process.env.AZURE_TRANSLATOR_REGION
    if (!region) {
      throw new Error('AZURE_TRANSLATOR_REGION environment variable is required')
    }
    this.apiKey = key
    this.region = region
  }

  async initialize(): Promise<void> {
    // Validate with a test request
    await this.translate('test', 'en-ja')
  }

  async translate(text: string, direction: Direction): Promise<string> {
    if (!text.trim()) return ''

    const [from, to] = direction.split('-') as [string, string]
    const params = new URLSearchParams({
      'api-version': API_VERSION,
      from,
      to
    })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

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
        throw new Error(`Microsoft Translator error: ${response.status}`)
      }

      const data = (await response.json()) as Array<{
        translations: Array<{ text: string }>
      }>
      return data[0]?.translations[0]?.text || ''
    } finally {
      clearTimeout(timeout)
    }
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }
}
