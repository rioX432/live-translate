import type { TranslatorEngine, Language } from '../types'

const GEMINI_API_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

const LANG_NAMES: Record<Language, string> = {
  ja: 'Japanese',
  en: 'English'
}

export class GeminiTranslator implements TranslatorEngine {
  readonly id = 'gemini-translate'
  readonly name = 'Gemini 2.5 Flash'
  readonly isOffline = false

  private apiKey: string
  private initialized = false

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (!this.apiKey) {
      throw new Error('Gemini API key is required')
    }
    // Validate API key with a test request
    try {
      await this.translate('test', 'en', 'ja')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`Invalid Gemini API key: ${msg}`)
    }
    this.initialized = true
  }

  async translate(text: string, from: Language, to: Language): Promise<string> {
    if (!text.trim()) return ''

    const prompt = `Translate the following ${LANG_NAMES[from]} text to ${LANG_NAMES[to]}. Output ONLY the translated text, nothing else.\n\n${text}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    try {
      const response = await fetch(GEMINI_API_URL, {
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
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        if (response.status === 400 || response.status === 403) {
          throw new Error('Gemini API: Invalid API key')
        }
        if (response.status === 429) {
          throw new Error('Gemini API: Rate limit exceeded')
        }
        throw new Error(`Gemini API error: ${response.status}`)
      }

      let data: {
        candidates?: Array<{
          content?: { parts?: Array<{ text?: string }> }
        }>
      }
      try {
        data = (await response.json()) as typeof data
      } catch {
        throw new Error('Gemini API: Invalid JSON response')
      }

      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || ''
    } finally {
      clearTimeout(timeout)
    }
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }
}
