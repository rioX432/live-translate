import { transcribe } from '@kutalia/whisper-node-addon'
import { getModelPath, isModelDownloaded, downloadModel } from '../model-downloader'
import type { STTEngine, STTResult, Language } from '../types'

export class WhisperLocalEngine implements STTEngine {
  readonly id = 'whisper-local'
  readonly name = 'Whisper Local (large-v3-turbo)'
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

  async processAudio(audioChunk: Float32Array, _sampleRate: number): Promise<STTResult | null> {
    if (!this.modelPath) throw new Error('Engine not initialized')

    try {
      const result = await transcribe({
        model: this.modelPath,
        pcmf32: audioChunk,
        language: 'auto',
        vad: true,
        no_timestamps: true,
        no_prints: true
      })

      const text = this.extractText(result.transcription)
      if (!text.trim()) return null

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
    }
  }

  async dispose(): Promise<void> {}

  private detectLanguage(text: string): Language {
    const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/g
    const matches = text.match(japanesePattern)
    const japaneseRatio = (matches?.length || 0) / text.length
    return japaneseRatio > 0.3 ? 'ja' : 'en'
  }

  private extractText(transcription: string[][] | string[]): string {
    if (!transcription || transcription.length === 0) return ''
    if (Array.isArray(transcription[0])) {
      return (transcription as string[][]).map((seg) => seg[seg.length - 1] || '').join(' ')
    }
    return (transcription as string[]).join(' ')
  }
}
