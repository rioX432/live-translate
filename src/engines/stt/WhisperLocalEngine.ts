import { transcribe } from '@kutalia/whisper-node-addon'
import { getModelPath, isModelDownloaded, downloadModel } from '../model-downloader'
import type { WhisperVariant } from '../model-downloader'
import { filterWhisperHallucination } from '../../pipeline/whisper-filter'
import type { STTEngine, STTResult, Language } from '../types'

export class WhisperLocalEngine implements STTEngine {
  readonly id = 'whisper-local'
  readonly name: string
  readonly isOffline = true

  private modelPath = ''
  private onProgress?: (message: string) => void
  private processing = false
  private modelVariant?: WhisperVariant

  constructor(options?: { onProgress?: (message: string) => void; modelVariant?: WhisperVariant }) {
    this.onProgress = options?.onProgress
    this.modelVariant = options?.modelVariant
    this.name = this.modelVariant === 'large-v3-turbo'
      ? 'Whisper Local (large-v3-turbo)'
      : 'Whisper Local (kotoba-whisper-v2.0)'
  }

  async initialize(): Promise<void> {
    if (this.modelPath) return
    if (!isModelDownloaded(this.modelVariant)) {
      this.modelPath = await downloadModel(this.onProgress, this.modelVariant)
    } else {
      this.modelPath = getModelPath(this.modelVariant)
    }
  }

  async processAudio(audioChunk: Float32Array, _sampleRate: number): Promise<STTResult | null> {
    if (!this.modelPath) return null
    // Serialize calls — whisper-node-addon uses Metal GPU which is not thread-safe
    if (this.processing) return null
    this.processing = true

    try {
      const result = await transcribe({
        model: this.modelPath,
        pcmf32: audioChunk,
        language: 'auto',
        vad: false,
        no_timestamps: true,
        no_prints: true
      })

      const rawText = this.extractText(result.transcription)
      const text = filterWhisperHallucination(rawText)
      if (!text) return null

      const language = this.detectLanguage(text)

      return {
        text,
        language,
        isFinal: true,
        timestamp: Date.now()
      }
    } catch (err) {
      console.error('Whisper transcription error:', err)
      return null
    } finally {
      this.processing = false
    }
  }

  async dispose(): Promise<void> {
    console.log('[whisper-local] Disposing resources')
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
