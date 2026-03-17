import { transcribe } from '@kutalia/whisper-node-addon'
import { getModelPath, isModelDownloaded, downloadModel } from '../model-downloader'
import type { E2ETranslationEngine, TranslationResult } from '../types'

/**
 * Offline E2E translation engine using Whisper's built-in translate task.
 *
 * Limitation: Only supports JA → EN translation.
 * Whisper's translate task always outputs English regardless of input language.
 */
export class WhisperTranslateEngine implements E2ETranslationEngine {
  readonly id = 'whisper-translate'
  readonly name = 'Whisper Translate (Offline, JA→EN only)'
  readonly isOffline = true

  private modelPath = ''
  private onProgress?: (message: string) => void

  constructor(options?: { onProgress?: (message: string) => void }) {
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    if (!isModelDownloaded()) {
      this.modelPath = await downloadModel(this.onProgress)
    } else {
      this.modelPath = getModelPath()
    }
  }

  async processAudio(
    audioChunk: Float32Array,
    _sampleRate: number
  ): Promise<TranslationResult | null> {
    if (!this.modelPath) return null

    try {
      // First: transcribe to get original Japanese text
      const transcribeResult = await transcribe({
        model: this.modelPath,
        pcmf32: audioChunk,
        language: 'ja',
        vad: true,
        no_timestamps: true,
        no_prints: true
      })

      const sourceText = this.extractText(transcribeResult.transcription)
      if (!sourceText.trim()) return null

      // Second: translate (Whisper outputs English)
      const translateResult = await transcribe({
        model: this.modelPath,
        pcmf32: audioChunk,
        language: 'ja',
        translate: true,
        vad: true,
        no_timestamps: true,
        no_prints: true
      })

      const translatedText = this.extractText(translateResult.transcription)
      if (!translatedText.trim()) return null

      return {
        sourceText,
        translatedText,
        sourceLanguage: 'ja',
        targetLanguage: 'en',
        timestamp: Date.now()
      }
    } catch (err) {
      console.error('Whisper translate error:', err)
      return null
    }
  }

  async dispose(): Promise<void> {
    // No cleanup needed
  }

  private extractText(transcription: string[][] | string[]): string {
    if (!transcription || transcription.length === 0) return ''
    if (Array.isArray(transcription[0])) {
      return (transcription as string[][]).map((seg) => seg[seg.length - 1] || '').join(' ')
    }
    return (transcription as string[]).join(' ')
  }
}
