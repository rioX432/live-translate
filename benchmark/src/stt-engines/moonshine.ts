import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { STTBenchmarkEngine } from '../stt-types.js'
import { PythonBridge } from '../bridge-utils.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE_SCRIPT = join(__dirname, '..', '..', 'resources', 'moonshine-bridge.py')

/**
 * Moonshine STT benchmark engine (Useful Sensors).
 * Lightweight on-device speech recognition optimized for edge.
 * Uses a Python bridge subprocess.
 */
export class MoonshineBench implements STTBenchmarkEngine {
  readonly id = 'moonshine'
  readonly label = 'Moonshine (Edge)'

  private bridge: PythonBridge
  private model: string

  constructor(options?: { model?: string }) {
    this.model = options?.model ?? 'moonshine/base'
    this.bridge = new PythonBridge(BRIDGE_SCRIPT)
  }

  async initialize(): Promise<void> {
    await this.bridge.start()
    const result = await this.bridge.send(
      { action: 'init', model: this.model },
      180_000
    )
    console.log(`[moonshine] Initialized: ${JSON.stringify(result)}`)
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
