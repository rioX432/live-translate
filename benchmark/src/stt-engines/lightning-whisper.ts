import type { STTBenchmarkEngine } from '../stt-types.js'
import { BenchmarkBridge, findPython3WithModule, getBridgePath } from './bridge-utils.js'

/**
 * Lightning Whisper MLX benchmark engine.
 * ~10x faster than whisper.cpp on Apple Silicon via optimized MLX kernels.
 */
export class LightningWhisperBench implements STTBenchmarkEngine {
  readonly id = 'lightning-whisper'
  readonly label = 'Lightning Whisper MLX'

  private bridge = new BenchmarkBridge('[lightning-whisper]')
  private model: string

  constructor(model = 'distil-large-v3') {
    this.model = model
  }

  async initialize(): Promise<void> {
    if (this.bridge.isRunning) return

    const python3 = findPython3WithModule('lightning_whisper_mlx', [
      'mlx-env',
      'lightning-whisper-env'
    ])
    console.log(`[lightning-whisper] Using Python: ${python3}`)

    await this.bridge.start(
      python3,
      [getBridgePath('lightning-whisper-bridge.py')],
      { action: 'init', model: this.model, batch_size: 12, quant: null }
    )
    console.log('[lightning-whisper] Ready')
  }

  async transcribe(audioPath: string, _language?: string): Promise<string> {
    const result = await this.bridge.sendCommand({
      action: 'transcribe',
      audio_path: audioPath,
      sample_rate: 16000
    })

    if (result.error) {
      throw new Error(`Transcription error: ${result.error}`)
    }

    return ((result.text as string) ?? '').trim()
  }

  async dispose(): Promise<void> {
    await this.bridge.stop()
  }
}
