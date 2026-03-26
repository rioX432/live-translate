import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { LANG_NAMES_EN } from '../language-names'
import { apiFetch, DEFAULT_TIMEOUT_MS } from './api-utils'
import { createLogger } from '../../main/logger'

const log = createLogger('gemini')

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

const ERROR_MAPPINGS = [
  { statuses: [400, 403], message: 'Invalid API key' },
  { statuses: [429], message: 'Rate limit exceeded' }
]

export class GeminiTranslator implements TranslatorEngine {
  readonly id = 'gemini-translate'
  readonly name = 'Gemini 2.5 Flash'
  readonly isOffline = false

  private apiKey: string
  private timeoutMs: number
  private initialized = false

  constructor(apiKey: string, options?: { timeoutMs?: number }) {
    this.apiKey = apiKey
    this.timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (!this.apiKey) {
      throw new Error('Gemini API key is required')
    }
    // API key validation deferred to first real translation to avoid wasting tokens
    this.initialized = true
  }

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text

    // Build context-enhanced prompt
    const contextParts: string[] = []
    if (context?.glossary && context.glossary.length > 0) {
      const entries = context.glossary.map((g) => `  "${g.source}" → "${g.target}"`).join('\n')
      contextParts.push(`Use these fixed translations for specific terms:\n${entries}`)
    }
    if (context?.previousSegments && context.previousSegments.length > 0) {
      const history = context.previousSegments
        .map((s) => `  ${s.source} → ${s.translated}`)
        .join('\n')
      contextParts.push(`Previous translations for context:\n${history}`)
    }
    if (context?.speakerId) {
      contextParts.push(`Current speaker: ${context.speakerId}. Maintain consistent style.`)
    }
    const contextSection = contextParts.length > 0 ? contextParts.join('\n\n') + '\n\n' : ''

    const prompt = `${contextSection}Translate the following ${LANG_NAMES_EN[from]} text to ${LANG_NAMES_EN[to]}. Output ONLY the translated text, nothing else.\n\n${text}`

    const data = await apiFetch<{
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> }
      }>
    }>({
      url: GEMINI_API_URL,
      init: {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 256
          }
        })
      },
      timeoutMs: this.timeoutMs,
      serviceName: 'Gemini API',
      errorMappings: ERROR_MAPPINGS
    })

    return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
  }

  async dispose(): Promise<void> {
    log.info('Disposing resources')
  }
}
