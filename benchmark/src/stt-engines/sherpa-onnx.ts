import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import type { STTBenchmarkEngine } from '../stt-types.js'

/** Sherpa-ONNX result interface */
interface SherpaOnnxResult {
  text: string
  lang?: string
}

/** Sherpa-ONNX module interface */
interface SherpaOnnxModule {
  OfflineRecognizer: new (config: Record<string, unknown>) => SherpaOnnxRecognizer
}

interface SherpaOnnxRecognizer {
  createStream(): SherpaOnnxStream
  decode(stream: SherpaOnnxStream): void
  getResult(stream: SherpaOnnxStream): SherpaOnnxResult
}

interface SherpaOnnxStream {
  acceptWaveform(params: { sampleRate: number; samples: Float32Array }): void
}

/** Supported model keys */
type SherpaModelKey = 'whisper-tiny' | 'whisper-base' | 'sensevoice-small' | 'paraformer-zh'

const MODEL_CONFIGS: Record<SherpaModelKey, {
  type: 'whisper' | 'sensevoice' | 'paraformer'
  dirName: string
  label: string
}> = {
  'whisper-tiny': { type: 'whisper', dirName: 'sherpa-onnx-whisper-tiny', label: 'Whisper Tiny' },
  'whisper-base': { type: 'whisper', dirName: 'sherpa-onnx-whisper-base', label: 'Whisper Base' },
  'sensevoice-small': { type: 'sensevoice', dirName: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17', label: 'SenseVoice Small' },
  'paraformer-zh': { type: 'paraformer', dirName: 'sherpa-onnx-paraformer-zh-2023-09-14', label: 'Paraformer (Chinese)' }
}

/**
 * Sherpa-ONNX benchmark engine using native Node.js addon.
 * No Python dependency — runs entirely in-process via ONNX runtime.
 */
export class SherpaOnnxBench implements STTBenchmarkEngine {
  readonly id = 'sherpa-onnx'
  readonly label: string

  private recognizer: SherpaOnnxRecognizer | null = null
  private modelKey: SherpaModelKey

  constructor(modelKey: SherpaModelKey = 'whisper-base') {
    this.modelKey = modelKey
    const config = MODEL_CONFIGS[this.modelKey]
    this.label = `Sherpa-ONNX (${config.label})`
  }

  async initialize(): Promise<void> {
    if (this.recognizer) return

    const modelConfig = MODEL_CONFIGS[this.modelKey]

    // Look for models in userData or common locations
    const modelsRoots = [
      join(homedir(), 'Library', 'Application Support', 'live-translate', 'models', 'sherpa-onnx'),
      join(homedir(), '.cache', 'sherpa-onnx')
    ]

    let modelDir: string | null = null
    for (const root of modelsRoots) {
      const candidate = join(root, modelConfig.dirName)
      if (existsSync(candidate)) {
        modelDir = candidate
        break
      }
    }

    if (!modelDir) {
      throw new Error(
        `[sherpa-onnx] Model directory not found for ${modelConfig.dirName}. ` +
        `Download from https://github.com/k2-fsa/sherpa-onnx/releases`
      )
    }

    // Dynamic require for the optional native addon
    let sherpaOnnx: SherpaOnnxModule
    try {
      sherpaOnnx = (await import('sherpa-onnx-node')).default as unknown as SherpaOnnxModule
    } catch (err) {
      throw new Error(
        `[sherpa-onnx] Failed to load sherpa-onnx-node. Install with: npm install sherpa-onnx-node. ` +
        `Error: ${err instanceof Error ? err.message : err}`
      )
    }

    const tokensPath = join(modelDir, 'tokens.txt')
    const config: Record<string, unknown> = {
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        tokens: tokensPath,
        numThreads: 2,
        provider: 'cpu',
        debug: 0,
        ...(modelConfig.type === 'whisper'
          ? { whisper: { encoder: join(modelDir, 'encoder.onnx'), decoder: join(modelDir, 'decoder.onnx') } }
          : modelConfig.type === 'sensevoice'
            ? { senseVoice: { model: join(modelDir, 'model.onnx') } }
            : { paraformer: { model: join(modelDir, 'model.int8.onnx') } })
      }
    }

    try {
      this.recognizer = new sherpaOnnx.OfflineRecognizer(config)
    } catch (err) {
      throw new Error(
        `[sherpa-onnx] Failed to create recognizer: ${err instanceof Error ? err.message : err}`
      )
    }

    console.log(`[sherpa-onnx] ${modelConfig.label} ready`)
  }

  async transcribe(audioPath: string, _language?: string): Promise<string> {
    if (!this.recognizer) throw new Error('Engine not initialized')

    const pcm = readWavAsPcm(audioPath)
    const stream = this.recognizer.createStream()
    stream.acceptWaveform({ sampleRate: 16000, samples: pcm })
    this.recognizer.decode(stream)
    const result = this.recognizer.getResult(stream)

    return (result.text ?? '').trim()
  }

  async dispose(): Promise<void> {
    this.recognizer = null
  }
}

/** Read a WAV file and return Float32Array of PCM samples */
function readWavAsPcm(wavPath: string): Float32Array {
  const buffer = readFileSync(wavPath)
  const dataOffset = 44
  const bitsPerSample = buffer.readUInt16LE(34)
  const numSamples = (buffer.length - dataOffset) / (bitsPerSample / 8)

  const samples = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    if (bitsPerSample === 16) {
      samples[i] = buffer.readInt16LE(dataOffset + i * 2) / 32768.0
    } else if (bitsPerSample === 32) {
      samples[i] = buffer.readFloatLE(dataOffset + i * 4)
    }
  }

  return samples
}
