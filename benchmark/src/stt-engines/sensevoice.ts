import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { STTBenchmarkEngine } from '../stt-types.js'
import { PythonBridge } from '../bridge-utils.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE_SCRIPT = join(__dirname, '..', '..', '..', 'resources', 'sensevoice-bridge.py')

/**
 * SenseVoice STT benchmark engine (FunASR).
 * Uses the existing resources/sensevoice-bridge.py via PythonBridge.
 */
export class SenseVoiceBench implements STTBenchmarkEngine {
  readonly id = 'sensevoice'
  readonly label = 'SenseVoice (FunASR)'

  private bridge: PythonBridge
  private model: string

  constructor(options?: { model?: string }) {
    this.model = options?.model ?? 'FunAudioLLM/SenseVoiceSmall'
    this.bridge = new PythonBridge(BRIDGE_SCRIPT)
  }

  async initialize(): Promise<void> {
    await this.bridge.start()
    const result = await this.bridge.send(
      { action: 'init', model: this.model },
      180_000
    )
    console.log(`[sensevoice] Initialized: ${JSON.stringify(result)}`)
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
