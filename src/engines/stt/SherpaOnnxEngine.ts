import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { app } from 'electron'
import type { STTEngine, STTResult, Language } from '../types'
import { ALL_LANGUAGES } from '../types'

/**
 * Sherpa-ONNX recognizer result as returned by getResult().
 * See OfflineRecognitionResult::AsJsonString() in C++ for full fields.
 */
interface SherpaOnnxResult {
  text: string
  lang?: string
  tokens?: string[]
  timestamps?: number[]
}

/** Minimal typings for the sherpa-onnx-node native addon */
interface SherpaOnnxModule {
  OfflineRecognizer: new (config: SherpaOnnxConfig) => SherpaOnnxRecognizer
}

interface SherpaOnnxRecognizer {
  createStream(): SherpaOnnxStream
  decode(stream: SherpaOnnxStream): void
  getResult(stream: SherpaOnnxStream): SherpaOnnxResult
}

interface SherpaOnnxStream {
  acceptWaveform(params: { sampleRate: number; samples: Float32Array }): void
}

interface SherpaOnnxConfig {
  featConfig: { sampleRate: number; featureDim: number }
  modelConfig: {
    whisper?: { encoder: string; decoder: string }
    senseVoice?: { model: string }
    paraformer?: { model: string }
    tokens: string
    numThreads: number
    provider: string
    debug: number
  }
}

/** Supported Sherpa-ONNX model types */
export type SherpaOnnxModelType = 'whisper' | 'sensevoice' | 'paraformer'

/** Configuration for a Sherpa-ONNX model */
export interface SherpaOnnxModelConfig {
  type: SherpaOnnxModelType
  /** Directory name under models/sherpa-onnx/ where model files are expected */
  dirName: string
  /** Human-readable label */
  label: string
  /** Description shown in UI */
  description: string
}

/** Available Sherpa-ONNX model presets */
export const SHERPA_ONNX_MODELS: Record<string, SherpaOnnxModelConfig> = {
  'whisper-tiny': {
    type: 'whisper',
    dirName: 'sherpa-onnx-whisper-tiny',
    label: 'Whisper Tiny',
    description: 'Whisper tiny.en — lightweight, English-focused (~75MB)'
  },
  'whisper-base': {
    type: 'whisper',
    dirName: 'sherpa-onnx-whisper-base',
    label: 'Whisper Base',
    description: 'Whisper base — multilingual, fast (~150MB)'
  },
  'sensevoice-small': {
    type: 'sensevoice',
    dirName: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
    label: 'SenseVoice Small',
    description: 'SenseVoice-Small — CJK-optimized with emotion detection (~230MB)'
  },
  'paraformer-zh': {
    type: 'paraformer',
    dirName: 'sherpa-onnx-paraformer-zh-2023-09-14',
    label: 'Paraformer (Chinese)',
    description: 'Paraformer — fast Chinese STT (~230MB)'
  }
}

import { createLogger } from '../../main/logger'

const log = createLogger('sherpa-onnx')
const MODELS_SUBDIR = 'sherpa-onnx'

/**
 * Sherpa-ONNX STT engine using native Node.js addon (no Python dependency).
 *
 * Sherpa-ONNX is a unified cross-platform toolkit providing STT, VAD,
 * speaker diarization, and TTS. This engine wraps the offline (non-streaming)
 * recognizer for batch transcription of audio chunks.
 *
 * Supports multiple model architectures: Whisper, SenseVoice, Paraformer.
 *
 * Requires: `npm install sherpa-onnx-node` and pre-downloaded model files
 * under `userData/models/sherpa-onnx/<model-dir>/`.
 */
export class SherpaOnnxEngine implements STTEngine {
  readonly id = 'sherpa-onnx'
  readonly name: string
  readonly isOffline = true

  private recognizer: SherpaOnnxRecognizer | null = null
  private initPromise: Promise<void> | null = null
  private modelKey: string
  private onProgress?: (message: string) => void

  constructor(options?: {
    modelKey?: string
    onProgress?: (message: string) => void
  }) {
    this.modelKey = options?.modelKey ?? 'whisper-base'
    this.onProgress = options?.onProgress
    const config = SHERPA_ONNX_MODELS[this.modelKey]
    this.name = config
      ? `Sherpa-ONNX (${config.label})`
      : 'Sherpa-ONNX'
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.recognizer) return

    const modelConfig = SHERPA_ONNX_MODELS[this.modelKey]
    if (!modelConfig) {
      throw new Error(`${'[sherpa-onnx]'} Unknown model key: ${this.modelKey}`)
    }

    this.onProgress?.(`Loading Sherpa-ONNX ${modelConfig.label}...`)

    // Ensure models directory exists
    const modelsRoot = join(app.getPath('userData'), 'models', MODELS_SUBDIR)
    if (!existsSync(modelsRoot)) {
      mkdirSync(modelsRoot, { recursive: true })
    }

    const modelDir = join(modelsRoot, modelConfig.dirName)
    if (!existsSync(modelDir)) {
      throw new Error(
        `${'[sherpa-onnx]'} Model directory not found: ${modelDir}. ` +
        `Download the model from https://github.com/k2-fsa/sherpa-onnx/releases ` +
        `and extract it to ${modelsRoot}/`
      )
    }

    // Dynamic require to avoid hard dependency — sherpa-onnx-node is optional.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    let sherpaOnnx: SherpaOnnxModule
    try {
      sherpaOnnx = require('sherpa-onnx-node') as SherpaOnnxModule
    } catch (err) {
      throw new Error(
        `${'[sherpa-onnx]'} Failed to load sherpa-onnx-node. ` +
        `Install it with: npm install sherpa-onnx-node. ` +
        `Error: ${err instanceof Error ? err.message : err}`
      )
    }

    const config = this.buildConfig(modelConfig, modelDir)

    try {
      this.recognizer = new sherpaOnnx.OfflineRecognizer(config)
    } catch (err) {
      throw new Error(
        `${'[sherpa-onnx]'} Failed to create recognizer: ${err instanceof Error ? err.message : err}`
      )
    }

    this.onProgress?.(`Sherpa-ONNX ${modelConfig.label} ready`)
  }

  private buildConfig(modelConfig: SherpaOnnxModelConfig, modelDir: string): SherpaOnnxConfig {
    const tokensPath = join(modelDir, 'tokens.txt')
    const base: SherpaOnnxConfig = {
      featConfig: {
        sampleRate: 16000,
        featureDim: 80
      },
      modelConfig: {
        tokens: tokensPath,
        numThreads: 2,
        provider: 'cpu',
        debug: 0
      }
    }

    switch (modelConfig.type) {
      case 'whisper':
        base.modelConfig.whisper = {
          encoder: join(modelDir, 'encoder.onnx'),
          decoder: join(modelDir, 'decoder.onnx')
        }
        break
      case 'sensevoice':
        base.modelConfig.senseVoice = {
          model: join(modelDir, 'model.onnx')
        }
        break
      case 'paraformer':
        base.modelConfig.paraformer = {
          model: join(modelDir, 'model.int8.onnx')
        }
        break
    }

    return base
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.recognizer) return null

    try {
      const stream = this.recognizer.createStream()
      stream.acceptWaveform({ sampleRate, samples: audioChunk })
      this.recognizer.decode(stream)
      const result = this.recognizer.getResult(stream)

      const text = (result.text ?? '').trim()
      if (!text) return null

      // Sherpa-ONNX returns a lang field (e.g., 'en', 'ja', 'zh')
      const detectedLang = result.lang
      const language: Language = (detectedLang && ALL_LANGUAGES.includes(detectedLang as Language))
        ? (detectedLang as Language)
        : this.detectLanguageFallback(text)

      return {
        text,
        language,
        isFinal: true,
        timestamp: Date.now()
      }
    } catch (err) {
      log.error('Transcription error:', err)
      return null
    }
  }

  async dispose(): Promise<void> {
    log.info('Disposing resources')
    // OfflineRecognizer is freed by GC; clear our reference
    this.recognizer = null
    this.initPromise = null
  }

  /**
   * Fallback script-based language detection when the model does not
   * provide a lang field (e.g., vanilla Whisper ONNX models).
   */
  private detectLanguageFallback(text: string): Language {
    if (!text) return 'en'

    const jpKana = text.match(/[\u3040-\u309F\u30A0-\u30FF]/g)
    const jpCount = jpKana?.length ?? 0
    if (jpCount / text.length > 0.3 && jpCount >= 2) return 'ja'

    const cjk = text.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g)
    const cjkCount = cjk?.length ?? 0
    if (cjkCount / text.length > 0.3 && cjkCount >= 2 && jpCount === 0) return 'zh'

    const ko = text.match(/[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g)
    const koCount = ko?.length ?? 0
    if (koCount / text.length > 0.3 && koCount >= 2) return 'ko'

    const th = text.match(/[\u0E00-\u0E7F]/g)
    const thCount = th?.length ?? 0
    if (thCount / text.length > 0.3 && thCount >= 2) return 'th'

    const ar = text.match(/[\u0600-\u06FF\u0750-\u077F]/g)
    const arCount = ar?.length ?? 0
    if (arCount / text.length > 0.3 && arCount >= 2) return 'ar'

    return 'en'
  }
}
