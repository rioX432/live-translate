import type { STTBenchmarkEngine } from '../stt-types.js'
import { BenchmarkBridge, findPython3WithModule, getBridgePath } from './bridge-utils.js'

/**
 * MLX Whisper benchmark engine.
 * Uses the mlx-whisper Python bridge for Apple Silicon optimized inference.
 */
export class MlxWhisperBench implements STTBenchmarkEngine {
  readonly id = 'mlx-whisper'
  readonly label = 'mlx-whisper (Apple Silicon)'

  private bridge = new BenchmarkBridge('[mlx-whisper]')
  private model: string

  constructor(model = 'mlx-community/whisper-large-v3-turbo') {
    this.model = model
  }

  async initialize(): Promise<void> {
    if (this.bridge.isRunning) return

    const python3 = findPython3WithModule('mlx_whisper', ['mlx-env'])
    console.log(`[mlx-whisper] Using Python: ${python3}`)

    await this.bridge.start(
      python3,
      [getBridgePath('mlx-whisper-bridge.py')],
      { action: 'init', model: this.model }
    )
    console.log('[mlx-whisper] Ready')
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
