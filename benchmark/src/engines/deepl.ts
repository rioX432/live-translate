import type { BenchmarkEngine, Direction } from '../types.js'

const DEEPL_FREE_URL = 'https://api-free.deepl.com/v2/translate'
const DEEPL_PRO_URL = 'https://api.deepl.com/v2/translate'
const TIMEOUT_MS = 15_000

/** DeepL language code mapping for benchmark directions */
const LANG_MAP: Record<string, { source: string; target: string }> = {
  ja: { source: 'JA', target: 'JA' },
  en: { source: 'EN', target: 'EN-US' }
}

export class DeepLBench implements BenchmarkEngine {
  readonly id = 'deepl'
  readonly label = 'DeepL Translate'

  private apiKey: string
  private apiUrl: string

  constructor() {
    const key = process.env.DEEPL_API_KEY
    if (!key) {
      throw new Error('DEEPL_API_KEY environment variable is required')
    }
    this.apiKey = key
    this.apiUrl = key.endsWith(':fx') ? DEEPL_FREE_URL : DEEPL_PRO_URL
  }

  async initialize(): Promise<void> {
    // Validate with a test request
    await this.translate('test', 'en-ja')
  }

  async translate(text: string, direction: Direction): Promise<string> {
    if (!text.trim()) return ''

    const [from, to] = direction.split('-') as [string, string]
    const sourceLang = LANG_MAP[from]?.source ?? from.toUpperCase()
    const targetLang = LANG_MAP[to]?.target ?? to.toUpperCase()

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    try {
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: [text],
          source_lang: sourceLang,
          target_lang: targetLang
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`DeepL API error: ${response.status}`)
      }

      const data = (await response.json()) as {
        translations: Array<{ text: string }>
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
