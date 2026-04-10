import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { execSync } from 'child_process'
import { app } from 'electron'
import type { STTEngine, STTResult, Language } from '../types'
import { ALL_LANGUAGES } from '../types'
import { createLogger } from '../../main/logger'

const log = createLogger('sensevoice-sherpa')

/**
 * SenseVoice Small model configuration for sherpa-onnx.
 *
 * Model: sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17
 * - Non-autoregressive: ~70ms for 10s audio (15x faster than Whisper-Large)
 * - 234M params, int8 quantized model ~229MB
 * - Languages: JA, EN, ZH, KO, Cantonese (yue)
 * - Features: emotion detection, audio event detection, ITN (punctuation)
 */
const SENSEVOICE_MODEL = {
  dirName: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
  /** tar.bz2 download URL from sherpa-onnx releases */
  downloadUrl:
    'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2',
  modelFile: 'model.int8.onnx',
  tokensFile: 'tokens.txt',
  sizeMB: 229
} as const

/** Minimal sherpa-onnx-node types for SenseVoice offline recognizer */
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

interface SherpaOnnxResult {
  text: string
  lang?: string
  tokens?: string[]
  timestamps?: number[]
}

interface SherpaOnnxConfig {
  featConfig: { sampleRate: number; featureDim: number }
  modelConfig: {
    senseVoice: { model: string; language: string; useItn: number }
    tokens: string
    numThreads: number
    provider: string
    debug: number
  }
}

/**
 * SenseVoice Small STT engine via sherpa-onnx native addon.
 *
 * Unlike the FunASR-based SenseVoiceEngine, this uses sherpa-onnx's
 * C++ ONNX Runtime — no Python dependency, lower overhead, and
 * cross-platform (macOS, Windows, Linux).
 *
 * SenseVoice Small (~234M params) is non-autoregressive, achieving
 * ~70ms inference for 10s audio. Supports JA/EN/ZH/KO with built-in
 * language detection, emotion recognition, and ITN (punctuation).
 *
 * Requires: `npm install sherpa-onnx-node` (optional dependency)
 * Model auto-downloads on first use (~229MB int8 quantized).
 *
 * TODO: Benchmark evaluation (#554)
 * - [ ] JA CER on standard test set (compare against MLX Whisper 8.1%)
 * - [ ] EN WER on standard test set (compare against MLX Whisper 3.8%)
 * - [ ] Latency measurement: cold start, per-chunk inference
 * - [ ] Memory usage: RSS after model load
 * - [ ] Streaming mode viability: test with short chunks (1-3s)
 * - [ ] Compare against Whisper Local (whisper.cpp) and Moonshine Tiny JA
 */
export class SenseVoiceSherpaEngine implements STTEngine {
  readonly id = 'sensevoice-sherpa'
  readonly name = 'SenseVoice Small (sherpa-onnx, ultra-fast)'
  readonly isOffline = true

  private recognizer: SherpaOnnxRecognizer | null = null
  private initPromise: Promise<void> | null = null
  private onProgress?: (message: string) => void

  constructor(options?: {
    onProgress?: (message: string) => void
  }) {
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.recognizer) return

    this.onProgress?.('Loading SenseVoice Small (sherpa-onnx)...')

    // Ensure model directory exists
    const modelsRoot = join(app.getPath('userData'), 'models', 'sherpa-onnx')
    if (!existsSync(modelsRoot)) {
      mkdirSync(modelsRoot, { recursive: true })
    }

    const modelDir = join(modelsRoot, SENSEVOICE_MODEL.dirName)

    // Auto-download model if not present
    if (!existsSync(modelDir)) {
      await this.downloadModel(modelsRoot, modelDir)
    }

    // Verify required files exist after download
    const modelPath = join(modelDir, SENSEVOICE_MODEL.modelFile)
    const tokensPath = join(modelDir, SENSEVOICE_MODEL.tokensFile)

    if (!existsSync(modelPath)) {
      throw new Error(
        `[sensevoice-sherpa] Model file not found: ${modelPath}. ` +
        `Delete ${modelDir} and restart to re-download.`
      )
    }
    if (!existsSync(tokensPath)) {
      throw new Error(
        `[sensevoice-sherpa] Tokens file not found: ${tokensPath}. ` +
        `Delete ${modelDir} and restart to re-download.`
      )
    }

    // Load sherpa-onnx-node native addon (optional dependency)
    let sherpaOnnx: SherpaOnnxModule
    try {
      sherpaOnnx = require('sherpa-onnx-node') as SherpaOnnxModule
    } catch (err) {
      throw new Error(
        '[sensevoice-sherpa] Failed to load sherpa-onnx-node. ' +
        'Install it with: npm install sherpa-onnx-node. ' +
        `Error: ${err instanceof Error ? err.message : err}`
      )
    }

    const config: SherpaOnnxConfig = {
      featConfig: {
        sampleRate: 16000,
        featureDim: 80
      },
      modelConfig: {
        senseVoice: {
          model: modelPath,
          language: 'auto',
          useItn: 1
        },
        tokens: tokensPath,
        numThreads: 2,
        provider: 'cpu',
        debug: 0
      }
    }

    try {
      this.recognizer = new sherpaOnnx.OfflineRecognizer(config)
    } catch (err) {
      throw new Error(
        `[sensevoice-sherpa] Failed to create recognizer: ${err instanceof Error ? err.message : err}`
      )
    }

    this.onProgress?.('SenseVoice Small (sherpa-onnx) ready')
    log.info('SenseVoice Small initialized successfully')
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

      // SenseVoice returns lang field (e.g., 'en', 'ja', 'zh', 'ko')
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
    log.info('Disposing SenseVoice sherpa-onnx resources')
    this.recognizer = null
    this.initPromise = null
  }

  /**
   * Download and extract the SenseVoice model tar.bz2 archive.
   * Uses system tar to extract (available on macOS and most Linux/Windows).
   */
  private async downloadModel(modelsRoot: string, modelDir: string): Promise<void> {
    const archivePath = join(modelsRoot, `${SENSEVOICE_MODEL.dirName}.tar.bz2`)

    try {
      this.onProgress?.(`Downloading SenseVoice Small model (~${SENSEVOICE_MODEL.sizeMB}MB)...`)
      log.info(`Downloading SenseVoice model from ${SENSEVOICE_MODEL.downloadUrl}`)

      // Download with fetch + streaming to disk
      const controller = new AbortController()
      const fetchTimeout = setTimeout(() => controller.abort(), 10 * 60_000)

      let response: Response
      try {
        response = await fetch(SENSEVOICE_MODEL.downloadUrl, {
          redirect: 'follow',
          signal: controller.signal
        })
      } finally {
        clearTimeout(fetchTimeout)
      }

      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`)
      }

      const contentLength = Number(response.headers.get('content-length')) || 0
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const { createWriteStream } = await import('fs')
      const ws = createWriteStream(archivePath)
      let downloaded = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        ws.write(Buffer.from(value))
        downloaded += value.byteLength

        if (contentLength > 0) {
          const pct = Math.round((downloaded / contentLength) * 100)
          const downloadedMB = (downloaded / 1024 / 1024).toFixed(0)
          const totalMB = (contentLength / 1024 / 1024).toFixed(0)
          this.onProgress?.(`Downloading SenseVoice: ${downloadedMB}/${totalMB}MB (${pct}%)`)
        }
      }

      await new Promise<void>((resolve, reject) => {
        ws.end(() => resolve())
        ws.on('error', reject)
      })

      // Extract archive
      this.onProgress?.('Extracting SenseVoice model...')
      log.info(`Extracting ${archivePath} to ${modelsRoot}`)

      execSync(`tar -xjf "${archivePath}" -C "${modelsRoot}"`, {
        timeout: 120_000
      })

      // Verify extraction succeeded
      if (!existsSync(modelDir)) {
        throw new Error(`Extraction completed but model directory not found: ${modelDir}`)
      }

      log.info('SenseVoice model downloaded and extracted successfully')
    } finally {
      // Clean up archive file
      try {
        const { unlinkSync } = await import('fs')
        if (existsSync(archivePath)) {
          unlinkSync(archivePath)
        }
      } catch (e) {
        log.warn('Failed to clean up archive:', e)
      }
    }
  }

  /**
   * Fallback script-based language detection when the model
   * does not provide a lang field in the result.
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

    return 'en'
  }
}
