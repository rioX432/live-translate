import { join } from 'path'
import type { STTEngine, STTResult, Language } from '../types'
import { getModelsDir, MOONSHINE_VARIANTS } from '../model-downloader'
import type { MoonshineVariant } from '../model-downloader'

const MODELS_SUBDIR = 'moonshine'

/** Minimal interface for the HuggingFace ASR pipeline (avoids complex union types) */
interface ASRPipeline {
  (audio: Float32Array, options?: { sampling_rate?: number }): Promise<{ text?: string }>
  dispose(): Promise<void>
}

export class MoonshineEngine implements STTEngine {
  readonly id = 'moonshine'
  readonly name = 'Moonshine AI (Fast)'
  readonly isOffline = true

  private pipeline: ASRPipeline | null = null
  private initPromise: Promise<void> | null = null
  private onProgress?: (message: string) => void
  private variant: MoonshineVariant

  constructor(options?: { onProgress?: (message: string) => void; variant?: MoonshineVariant }) {
    this.onProgress = options?.onProgress
    this.variant = options?.variant ?? 'base'
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.pipeline) return

    const config = MOONSHINE_VARIANTS[this.variant]
    this.onProgress?.(`Loading Moonshine ${config.label} model...`)

    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = join(getModelsDir(), MODELS_SUBDIR)

    this.pipeline = await pipeline(
      'automatic-speech-recognition',
      config.modelId,
      { dtype: 'q8' }
    ) as unknown as ASRPipeline

    this.onProgress?.(`Moonshine ${config.label} model loaded`)
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.pipeline) return null

    try {
      const result = await this.pipeline(audioChunk, {
        sampling_rate: sampleRate
      })

      const text = (result?.text ?? '').trim()
      if (!text) return null

      // Detect language using script-based heuristic (Moonshine is primarily English-focused)
      const jaKanaMatches = text.match(/[\u3040-\u309F\u30A0-\u30FF]/g)
      const jaKanaCount = jaKanaMatches?.length || 0
      const cjkMatches = text.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g)
      const cjkCount = cjkMatches?.length || 0
      const koMatches = text.match(/[\uAC00-\uD7AF]/g)
      const koCount = koMatches?.length || 0

      let language: Language = 'en'
      if (jaKanaCount / text.length > 0.3 && jaKanaCount >= 2) {
        language = 'ja'
      } else if (cjkCount / text.length > 0.3 && cjkCount >= 2 && jaKanaCount === 0) {
        language = 'zh'
      } else if (koCount / text.length > 0.3 && koCount >= 2) {
        language = 'ko'
      }

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
    console.log('[moonshine] Disposing resources')
    try {
      await this.pipeline?.dispose()
    } catch (err) {
      console.error('[moonshine] Error during pipeline disposal:', err)
    }
    this.pipeline = null
    this.initPromise = null
  }
}
