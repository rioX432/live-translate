import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import type { STTEngine, STTResult, Language } from '../types'
import { ALL_LANGUAGES } from '../types'
import { getModelsDir } from '../model-downloader'

/**
 * Minimal interface for the sherpa-onnx-node addon.
 * We declare only the parts we use to avoid hard-coupling to the package
 * (it is an optional native dependency).
 */
export interface SherpaOnnxModule {
  OfflineRecognizer: new (config: SherpaOnnxOfflineConfig) => SherpaOnnxRecognizer
  readWave: (filename: string) => { samples: Float32Array; sampleRate: number }
}

interface SherpaOnnxOfflineConfig {
  featConfig: { sampleRate: number; featureDim: number }
  modelConfig: {
    whisper?: { encoder: string; decoder: string }
    senseVoice?: { model: string; useInverseTextNormalization?: number }
    paraformer?: { model: string }
    nemoCtc?: { model: string }
    tokens: string
    numThreads: number
    provider: string
    debug: number
  }
}

interface SherpaOnnxStream {
  acceptWaveform(opts: { sampleRate: number; samples: Float32Array }): void
}

interface SherpaOnnxResult {
  text: string
  lang?: string
  timestamps?: number[]
  tokens?: string
  json?: string
}

interface SherpaOnnxRecognizer {
  config: SherpaOnnxOfflineConfig
  createStream(): SherpaOnnxStream
  decode(stream: SherpaOnnxStream): void
  getResult(stream: SherpaOnnxStream): SherpaOnnxResult
}

/** Sherpa-ONNX model preset identifier */
export type SherpaOnnxPreset = 'whisper-tiny' | 'whisper-base' | 'whisper-small' | 'sensevoice' | 'paraformer'

/** Sherpa-ONNX model preset configuration */
export interface SherpaOnnxPresetConfig {
  /** Human-readable label */
  label: string
  /** Description shown in UI */
  description: string
  /** Model directory name under sherpa-onnx models dir */
  dirName: string
  /** Download URL for the tar.bz2 archive */
  downloadUrl: string
  /** Approximate download size in MB */
  sizeMB: number
  /** Function to build the modelConfig portion of OfflineRecognizer config */
  buildModelConfig: (modelDir: string) => SherpaOnnxOfflineConfig['modelConfig']
}

/** Available Sherpa-ONNX model presets */
export const SHERPA_ONNX_PRESETS: Record<SherpaOnnxPreset, SherpaOnnxPresetConfig> = {
  'whisper-tiny': {
    label: 'Whisper Tiny (Fast)',
    description: 'OpenAI Whisper tiny via Sherpa-ONNX — ~75MB, fastest, good for quick recognition',
    dirName: 'sherpa-onnx-whisper-tiny',
    downloadUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2',
    sizeMB: 75,
    buildModelConfig: (modelDir) => ({
      whisper: {
        encoder: join(modelDir, 'tiny-encoder.int8.onnx'),
        decoder: join(modelDir, 'tiny-decoder.int8.onnx'),
      },
      tokens: join(modelDir, 'tiny-tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    }),
  },
  'whisper-base': {
    label: 'Whisper Base (Balanced)',
    description: 'OpenAI Whisper base via Sherpa-ONNX — ~140MB, good balance of speed and accuracy',
    dirName: 'sherpa-onnx-whisper-base',
    downloadUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-base.tar.bz2',
    sizeMB: 140,
    buildModelConfig: (modelDir) => ({
      whisper: {
        encoder: join(modelDir, 'base-encoder.int8.onnx'),
        decoder: join(modelDir, 'base-decoder.int8.onnx'),
      },
      tokens: join(modelDir, 'base-tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    }),
  },
  'whisper-small': {
    label: 'Whisper Small (Best Accuracy)',
    description: 'OpenAI Whisper small via Sherpa-ONNX — ~460MB, best accuracy for multilingual',
    dirName: 'sherpa-onnx-whisper-small',
    downloadUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-small.tar.bz2',
    sizeMB: 460,
    buildModelConfig: (modelDir) => ({
      whisper: {
        encoder: join(modelDir, 'small-encoder.int8.onnx'),
        decoder: join(modelDir, 'small-decoder.int8.onnx'),
      },
      tokens: join(modelDir, 'small-tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    }),
  },
  'sensevoice': {
    label: 'SenseVoice (CJK-optimized)',
    description: 'SenseVoice via Sherpa-ONNX — ~220MB, fast with emotion/event detection, no Python needed',
    dirName: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
    downloadUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2',
    sizeMB: 220,
    buildModelConfig: (modelDir) => ({
      senseVoice: {
        model: join(modelDir, 'model.int8.onnx'),
        useInverseTextNormalization: 1,
      },
      tokens: join(modelDir, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    }),
  },
  'paraformer': {
    label: 'Paraformer (CJK, ultra-fast)',
    description: 'Paraformer via Sherpa-ONNX — ~230MB, extremely fast non-autoregressive model',
    dirName: 'sherpa-onnx-paraformer-zh-2023-09-14',
    downloadUrl: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-paraformer-zh-2023-09-14.tar.bz2',
    sizeMB: 230,
    buildModelConfig: (modelDir) => ({
      paraformer: {
        model: join(modelDir, 'model.int8.onnx'),
      },
      tokens: join(modelDir, 'tokens.txt'),
      numThreads: 2,
      provider: 'cpu',
      debug: 0,
    }),
  },
}

/** Sherpa-ONNX language code to ISO 639-1 mapping */
const SHERPA_LANG_MAP: Record<string, Language> = {
  'zh': 'zh',
  'en': 'en',
  'ja': 'ja',
  'ko': 'ko',
  'fr': 'fr',
  'de': 'de',
  'es': 'es',
  'pt': 'pt',
  'ru': 'ru',
  'it': 'it',
  'nl': 'nl',
  'pl': 'pl',
  'ar': 'ar',
  'th': 'th',
  'vi': 'vi',
  'id': 'id',
  'yue': 'zh', // Cantonese → Chinese
}

/**
 * Load the sherpa-onnx-node module at runtime.
 * Extracted as a module-level function so tests can mock it.
 */
export function loadSherpaModule(): SherpaOnnxModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('sherpa-onnx-node') as SherpaOnnxModule
}

/**
 * Sherpa-ONNX STT engine using native Node.js addon (sherpa-onnx-node).
 *
 * Benefits over the Python subprocess bridges:
 * - No Python dependency — pure Node.js native addon
 * - No temp WAV files — accepts Float32Array directly
 * - Unified toolkit: STT, VAD, speaker diarization in one package
 * - Cross-platform: macOS, Linux, Windows
 *
 * Requires: npm install sherpa-onnx-node
 * Models auto-download from k2-fsa/sherpa-onnx GitHub releases on first use.
 */
export class SherpaOnnxSTTEngine implements STTEngine {
  readonly id = 'sherpa-onnx'
  readonly name: string
  readonly isOffline = true

  private sherpaModule: SherpaOnnxModule | null = null
  private recognizer: SherpaOnnxRecognizer | null = null
  private initPromise: Promise<void> | null = null
  private processing = false
  private preset: SherpaOnnxPreset
  private onProgress?: (message: string) => void
  private moduleLoader: () => SherpaOnnxModule

  constructor(options?: {
    preset?: SherpaOnnxPreset
    onProgress?: (message: string) => void
    /** Override the module loader for testing. Defaults to loadSherpaModule(). */
    moduleLoader?: () => SherpaOnnxModule
  }) {
    this.preset = options?.preset ?? 'whisper-tiny'
    this.onProgress = options?.onProgress
    this.moduleLoader = options?.moduleLoader ?? loadSherpaModule
    const config = SHERPA_ONNX_PRESETS[this.preset]
    this.name = `Sherpa-ONNX (${config.label})`
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.recognizer) return

    const presetConfig = SHERPA_ONNX_PRESETS[this.preset]
    this.onProgress?.(`Loading Sherpa-ONNX ${presetConfig.label}...`)

    // Load sherpa-onnx-node (optional native dependency)
    try {
      this.sherpaModule = this.moduleLoader()
    } catch (err) {
      throw new Error(
        'sherpa-onnx-node is not installed. Run: npm install sherpa-onnx-node\n' +
        (err instanceof Error ? err.message : String(err))
      )
    }

    // Ensure model directory exists and download if needed
    const modelsDir = getSherpaModelsDir()
    const modelDir = join(modelsDir, presetConfig.dirName)

    if (!existsSync(modelDir)) {
      this.onProgress?.(`Downloading ${presetConfig.label} model (~${presetConfig.sizeMB}MB)...`)
      await downloadAndExtractModel(presetConfig, modelsDir, this.onProgress)
    }

    // Verify model files exist after download
    const modelConfig = presetConfig.buildModelConfig(modelDir)
    this.onProgress?.('Initializing Sherpa-ONNX recognizer...')

    try {
      this.recognizer = new this.sherpaModule.OfflineRecognizer({
        featConfig: {
          sampleRate: 16000,
          featureDim: 80,
        },
        modelConfig,
      })
    } catch (err) {
      throw new Error(
        `Failed to create Sherpa-ONNX recognizer: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    this.onProgress?.(`Sherpa-ONNX ${presetConfig.label} ready`)
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.recognizer) return null

    // Serialize calls — ONNX runtime is not thread-safe for concurrent decode
    if (this.processing) return null
    this.processing = true

    try {
      const stream = this.recognizer.createStream()
      stream.acceptWaveform({ sampleRate, samples: audioChunk })

      this.recognizer.decode(stream)
      const result = this.recognizer.getResult(stream)

      const text = (result.text ?? '').trim()
      if (!text) return null

      // Use lang field from the result if available, otherwise detect from script
      const language = resolveLanguage(result.lang, text)

      return {
        text,
        language,
        isFinal: true,
        timestamp: Date.now(),
      }
    } catch (err) {
      console.error('[sherpa-onnx] Recognition error:', err)
      return null
    } finally {
      this.processing = false
    }
  }

  async dispose(): Promise<void> {
    console.log('[sherpa-onnx] Disposing resources')
    this.recognizer = null
    this.sherpaModule = null
    this.initPromise = null
  }
}

/**
 * Resolve the detected language from Sherpa-ONNX result.
 * Falls back to script-based heuristic if the model does not provide lang.
 */
function resolveLanguage(lang: string | undefined, text: string): Language {
  // If sherpa-onnx returned a lang code, try to map it
  if (lang) {
    const cleaned = lang.replace(/[<>]/g, '').trim().toLowerCase()
    if (SHERPA_LANG_MAP[cleaned]) return SHERPA_LANG_MAP[cleaned]
    // Try direct match against ALL_LANGUAGES
    if (ALL_LANGUAGES.includes(cleaned as Language)) return cleaned as Language
  }

  // Fallback: script-based detection (same heuristic as WhisperLocalEngine)
  const jaKanaMatches = text.match(/[\u3040-\u309F\u30A0-\u30FF]/g)
  const jaKanaCount = jaKanaMatches?.length ?? 0
  if (jaKanaCount / text.length > 0.3 && jaKanaCount >= 2) return 'ja'

  const cjkMatches = text.match(/[\u4E00-\u9FFF\u3400-\u4DBF]/g)
  const cjkCount = cjkMatches?.length ?? 0
  if (cjkCount / text.length > 0.3 && cjkCount >= 2 && jaKanaCount === 0) return 'zh'

  const koMatches = text.match(/[\uAC00-\uD7AF]/g)
  const koCount = koMatches?.length ?? 0
  if (koCount / text.length > 0.3 && koCount >= 2) return 'ko'

  return 'en'
}

/** Get the Sherpa-ONNX models subdirectory */
function getSherpaModelsDir(): string {
  const dir = join(getModelsDir(), 'sherpa-onnx')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/**
 * Download and extract a Sherpa-ONNX model archive.
 * Uses tar.bz2 archives from k2-fsa/sherpa-onnx GitHub releases.
 */
async function downloadAndExtractModel(
  config: SherpaOnnxPresetConfig,
  modelsDir: string,
  onProgress?: (message: string) => void
): Promise<void> {
  const { execFile } = await import('child_process')
  const { promisify } = await import('util')
  const { createWriteStream, unlinkSync } = await import('fs')
  const execFileAsync = promisify(execFile)

  const archivePath = join(modelsDir, `${config.dirName}.tar.bz2`)

  try {
    // Download the archive with progress reporting
    onProgress?.(`Downloading ${config.label} (~${config.sizeMB}MB)...`)

    const controller = new AbortController()
    const fetchTimeout = setTimeout(() => controller.abort(), 10 * 60_000)

    let response: Response
    try {
      response = await fetch(config.downloadUrl, {
        redirect: 'follow',
        signal: controller.signal,
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

    const ws = createWriteStream(archivePath)
    let downloaded = 0

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        ws.write(value)
        downloaded += value.length
        if (contentLength > 0) {
          const pct = Math.round((downloaded / contentLength) * 100)
          const mb = (downloaded / 1024 / 1024).toFixed(1)
          const totalMb = (contentLength / 1024 / 1024).toFixed(0)
          onProgress?.(`Downloading ${config.label}... ${pct}% (${mb}/${totalMb} MB)`)
        }
      }
      ws.end()
      await new Promise<void>((resolve, reject) => {
        ws.on('finish', resolve)
        ws.on('error', reject)
      })
    } catch (err) {
      ws.end()
      throw err
    }

    // Extract the archive
    onProgress?.(`Extracting ${config.label}...`)
    await execFileAsync('tar', ['xjf', archivePath, '-C', modelsDir])

    onProgress?.(`${config.label} model ready`)
  } finally {
    // Clean up the archive file
    try {
      if (existsSync(archivePath)) unlinkSync(archivePath)
    } catch (e) {
      console.warn('[sherpa-onnx] Failed to clean up archive:', e)
    }
  }
}
