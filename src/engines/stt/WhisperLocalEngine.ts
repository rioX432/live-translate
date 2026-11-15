import { transcribe } from '@kutalia/whisper-node-addon'
import { getModelPath, isModelDownloaded, downloadModel } from '../model-downloader'
import { filterWhisperHallucination } from '../../pipeline/whisper-filter'
import type { STTEngine, STTResult, Language } from '../types'
import { createLogger } from '../../main/logger'

const log = createLogger('whisper-local')

const LANGUAGES: ReadonlySet<string> = new Set<Language>([
  'ja', 'en', 'zh', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'it', 'nl', 'pl', 'ar', 'th', 'vi', 'id'
])

/** Whisper reports ISO 639-1 codes; codes the app does not support return null. */
export function mapWhisperLanguage(code: unknown): Language | null {
  return typeof code === 'string' && LANGUAGES.has(code) ? (code as Language) : null
}

/**
 * whisper.cpp large-v3-turbo through @kutalia/whisper-node-addon. This is the STT on
 * platforms where Qwen3-ASR (MLX, Apple Silicon only) cannot run: Windows and Intel Macs.
 */
export class WhisperLocalEngine implements STTEngine {
  readonly id = 'whisper-local'
  readonly name = 'Whisper Local (large-v3-turbo)'
  readonly isOffline = true

  private modelPath = ''
  private onProgress?: (message: string) => void

  // Promise-based mutex — queues callers so only one transcribe() runs at a time (#363)
  private mutex: Promise<void> = Promise.resolve()

  constructor(options?: { onProgress?: (message: string) => void }) {
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    if (this.modelPath) return
    this.modelPath = isModelDownloaded() ? getModelPath() : await downloadModel(this.onProgress)
  }

  async processAudio(audioChunk: Float32Array, _sampleRate: number): Promise<STTResult | null> {
    if (!this.modelPath) throw new Error('[whisper-local] Not initialized')
    if (audioChunk.length === 0) return null

    // Promise-based mutex — serializes all calls so whisper-node-addon's
    // Metal GPU context is never entered concurrently (#363).
    // Each call chains onto the previous promise, guaranteeing FIFO order.
    let release: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const prev = this.mutex
    this.mutex = gate

    try {
      await prev
    } catch {
      // Previous call's error doesn't affect us
    }

    try {
      const result = await transcribe({
        model: this.modelPath,
        pcmf32: audioChunk,
        language: 'auto',
        // The addon's JS wrapper defaults translate to true, which turns Japanese speech into English text.
        translate: false,
        vad: false,
        no_timestamps: true,
        no_prints: true
      })

      const rawText = this.extractText(result.transcription)
      const text = filterWhisperHallucination(rawText)
      if (!text) return null

      const language = mapWhisperLanguage((result as { language?: unknown }).language) ?? this.detectLanguage(text)

      return {
        text,
        language,
        isFinal: true,
        timestamp: Date.now()
      }
    } catch (err) {
      log.error('Transcription error:', err)
      // Thrown, not swallowed: the pipeline reports it and re-initializes after repeated failures
      throw err
    } finally {
      release!()
    }
  }

  async dispose(): Promise<void> {
    // Let a transcription in flight finish, so quitting never tears the addon down
    // under a running worker (#15).
    await this.mutex.catch(() => {})
    this.modelPath = ''
  }

  private detectLanguage(text: string): Language {
    if (!text || text.length === 0) return 'en'

    // Japanese: Hiragana, Katakana, CJK ideographs (when mixed with kana)
    const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF]/g
    const jpMatches = text.match(japanesePattern)
    const jpCount = jpMatches?.length || 0
    const jpRatio = jpCount / text.length
    if (jpRatio > 0.3 && jpCount >= 2) return 'ja'

    // Chinese: CJK ideographs without Japanese kana
    const cjkPattern = /[\u4E00-\u9FFF\u3400-\u4DBF]/g
    const cjkMatches = text.match(cjkPattern)
    const cjkCount = cjkMatches?.length || 0
    const cjkRatio = cjkCount / text.length
    if (cjkRatio > 0.3 && cjkCount >= 2 && jpCount === 0) return 'zh'

    // Korean: Hangul syllables and jamo
    const koreanPattern = /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g
    const koMatches = text.match(koreanPattern)
    const koCount = koMatches?.length || 0
    const koRatio = koCount / text.length
    if (koRatio > 0.3 && koCount >= 2) return 'ko'

    // Thai
    const thaiPattern = /[\u0E00-\u0E7F]/g
    const thMatches = text.match(thaiPattern)
    const thCount = thMatches?.length || 0
    if (thCount / text.length > 0.3 && thCount >= 2) return 'th'

    // Arabic
    const arabicPattern = /[\u0600-\u06FF\u0750-\u077F]/g
    const arMatches = text.match(arabicPattern)
    const arCount = arMatches?.length || 0
    if (arCount / text.length > 0.3 && arCount >= 2) return 'ar'

    // Default to English for Latin-script languages
    // (more precise detection for fr/de/es/etc. relies on Whisper's own language detection)
    return 'en'
  }

  private extractText(transcription: string[][] | string[]): string {
    if (!transcription || transcription.length === 0) return ''
    if (Array.isArray(transcription[0])) {
      return (transcription as string[][]).map((seg) => seg[seg.length - 1] || '').join(' ')
    }
    return (transcription as string[]).join(' ')
  }
}
