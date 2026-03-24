import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { STTBenchmarkEngine } from '../stt-types.js'
import { PythonBridge } from '../bridge-utils.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE_SCRIPT = join(__dirname, '..', '..', 'resources', 'qwen-asr-bridge.py')

/**
 * Qwen-ASR STT benchmark engine (Qwen2-Audio / Qwen-Audio-Chat).
 * Uses a Python bridge subprocess for the FunASR/transformers backend.
 */
export class QwenASRBench implements STTBenchmarkEngine {
  readonly id = 'qwen-asr'
  readonly label = 'Qwen ASR'

  private bridge: PythonBridge
  private model: string

  constructor(options?: { model?: string }) {
    this.model = options?.model ?? 'Qwen/Qwen2-Audio-7B-Instruct'
    this.bridge = new PythonBridge(BRIDGE_SCRIPT)
  }

  async initialize(): Promise<void> {
    await this.bridge.start()
    const result = await this.bridge.send(
      { action: 'init', model: this.model },
      300_000 // Large model, may take time to download
    )
    console.log(`[qwen-asr] Initialized: ${JSON.stringify(result)}`)
  }

  async transcribe(audioPath: string): Promise<{ text: string; language?: string }> {
    const result = await this.bridge.send(
      { action: 'transcribe', audio_path: audioPath, sample_rate: 16000 },
      120_000
    )

    return {
      text: String(result.text ?? ''),
      language: result.language ? String(result.language) : undefined
    }
  }

  async dispose(): Promise<void> {
    await this.bridge.stop()
  }
}
