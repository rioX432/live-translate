import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { STTBenchmarkEngine } from '../stt-types.js'
import { PythonBridge } from '../bridge-utils.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE_SCRIPT = join(__dirname, '..', '..', 'resources', 'moonshine-tiny-ja-bridge.py')

/**
 * Moonshine Tiny JA benchmark engine (27M params, Japanese-specialized).
 * Uses Python transformers pipeline via PythonBridge.
 */
export class MoonshineTinyJaBench implements STTBenchmarkEngine {
  readonly id = 'moonshine-tiny-ja'
  readonly label = 'Moonshine Tiny JA (27M)'

  private bridge: PythonBridge
  private model: string

  constructor(options?: { model?: string }) {
    this.model = options?.model ?? 'UsefulSensors/moonshine-tiny-ja'
    this.bridge = new PythonBridge(BRIDGE_SCRIPT, 'python3.12')
  }

  async initialize(): Promise<void> {
    await this.bridge.start()
    const result = await this.bridge.send(
      { action: 'init', model: this.model },
      300_000
    )
    console.log(`[moonshine-tiny-ja] Initialized: ${JSON.stringify(result)}`)
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
