import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { apiFetch, apiInitialize, DEFAULT_TIMEOUT_MS } from './api-utils'

const DEEPL_FREE_URL = 'https://api-free.deepl.com/v2/translate'
const DEEPL_PRO_URL = 'https://api.deepl.com/v2/translate'

/** Map Language codes to DeepL API source/target codes */
const LANG_MAP: Record<Language, { source: string; target: string }> = {
  ja: { source: 'JA', target: 'JA' },
  en: { source: 'EN', target: 'EN-US' },
  zh: { source: 'ZH', target: 'ZH-HANS' },
  ko: { source: 'KO', target: 'KO' },
  fr: { source: 'FR', target: 'FR' },
  de: { source: 'DE', target: 'DE' },
  es: { source: 'ES', target: 'ES' },
  pt: { source: 'PT', target: 'PT-BR' },
  ru: { source: 'RU', target: 'RU' },
  it: { source: 'IT', target: 'IT' },
  nl: { source: 'NL', target: 'NL' },
  pl: { source: 'PL', target: 'PL' },
  ar: { source: 'AR', target: 'AR' },
  th: { source: 'TH', target: 'TH' },
  vi: { source: 'VI', target: 'VI' },
  id: { source: 'ID', target: 'ID' }
}

const ERROR_MAPPINGS = [
  { statuses: [401, 403], message: 'Invalid or expired API key' },
  { statuses: [429], message: 'Rate limit exceeded' },
  { statuses: [456], message: 'Quota exceeded' }
]

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
    const alreadyInit = await apiInitialize({
      initialized: this.initialized,
      apiKey: this.apiKey,
      keyName: 'DeepL API key',
      serviceName: 'DeepL API',
      testTranslate: () => this.translate('test', 'en', 'ja')
    })
    if (!alreadyInit) this.initialized = true
  }

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text

    // Build context string from previous segments for DeepL's context parameter
    let contextStr: string | undefined
    if (context?.previousSegments?.length) {
      contextStr = context.previousSegments.map((s) => s.source).join(' ')
    }

    const data = await apiFetch<{
      translations: Array<{ text: string; detected_source_language: string }>
    }>({
      url: this.apiUrl,
      init: {
        method: 'POST',
        headers: {
          Authorization: `DeepL-Auth-Key ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text: [text],
          source_lang: LANG_MAP[from].source,
          target_lang: LANG_MAP[to].target,
          ...(contextStr && { context: contextStr })
        })
      },
      timeoutMs: this.timeoutMs,
      serviceName: 'DeepL API',
      errorMappings: ERROR_MAPPINGS
    })

    return data.translations[0]?.text || ''
  }

  async dispose(): Promise<void> {
    console.log('[deepl] Disposing resources')
  }
}
