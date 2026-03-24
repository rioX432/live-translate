import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { STTBenchmarkEngine } from '../stt-types.js'
import { PythonBridge } from '../bridge-utils.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE_SCRIPT = join(
  __dirname, '..', '..', '..', 'resources', 'lightning-whisper-bridge.py'
)

/**
 * Lightning Whisper MLX STT benchmark engine.
 * Uses the existing resources/lightning-whisper-bridge.py via PythonBridge.
 */
export class LightningWhisperBench implements STTBenchmarkEngine {
  readonly id = 'lightning-whisper'
  readonly label = 'Lightning Whisper MLX'

  private bridge: PythonBridge
  private model: string
  private batchSize: number

  constructor(options?: { model?: string; batchSize?: number }) {
    this.model = options?.model ?? 'distil-large-v3'
    this.batchSize = options?.batchSize ?? 12
    this.bridge = new PythonBridge(BRIDGE_SCRIPT)
  }

  async initialize(): Promise<void> {
    await this.bridge.start()
    const result = await this.bridge.send(
      { action: 'init', model: this.model, batch_size: this.batchSize },
      180_000
    )
    console.log(`[lightning-whisper] Initialized: ${JSON.stringify(result)}`)
  }

  async transcribe(audioPath: string): Promise<{ text: string; language?: string }> {
    const result = await this.bridge.send({
      action: 'transcribe',
      audio_path: audioPath,
      sample_rate: 16000
    })

    return {
      text: String(result.text ?? ''),
      language: result.language ? String(result.language) : undefined
    }
  }

  async dispose(): Promise<void> {
    await this.bridge.stop()
  }
}
