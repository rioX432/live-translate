import { join } from 'path'
import { existsSync } from 'fs'
import type { STTEngine, STTResult, Language } from '../types'
import { getModelsDir } from '../model-downloader'

const MOONSHINE_MODEL = 'onnx-community/moonshine-base-ONNX'
const MODELS_SUBDIR = 'moonshine'

// Simple Japanese detection heuristic (same as WhisperLocalEngine)
const JA_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/

export class MoonshineEngine implements STTEngine {
  readonly id = 'moonshine'
  readonly name = 'Moonshine AI (Fast)'
  readonly isOffline = true

  private pipeline: any = null
  private onProgress?: (message: string) => void

  constructor(options?: { onProgress?: (message: string) => void }) {
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    if (this.pipeline) return

    this.onProgress?.('Loading Moonshine model...')

    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = join(getModelsDir(), MODELS_SUBDIR)

    this.pipeline = await pipeline(
      'automatic-speech-recognition',
      MOONSHINE_MODEL,
      { dtype: 'q8' }
    )

    this.onProgress?.('Moonshine model loaded')
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.pipeline) return null

    try {
      const result = await this.pipeline(audioChunk, {
        sampling_rate: sampleRate
      })

      const text = (result?.text ?? '').trim()
      if (!text) return null

      // Detect language from text content
      const language: Language = JA_REGEX.test(text) ? 'ja' : 'en'

      return {
        text,
        language,
        isFinal: true,
        timestamp: Date.now()
      }
    } catch (err) {
      console.error('[moonshine] Transcription error:', err)
      return null
    }
  }

  async dispose(): Promise<void> {
    this.pipeline = null
  }
}
