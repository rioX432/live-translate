import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import type { STTBenchmarkEngine } from '../stt-types.js'
import { PythonBridge } from '../bridge-utils.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const BRIDGE_SCRIPT = join(__dirname, '..', '..', 'resources', 'sherpa-onnx-bridge.py')

/**
 * Sherpa-ONNX STT benchmark engine.
 * Uses sherpa-onnx Python bindings via subprocess bridge.
 * Optimized for low-latency on-device inference.
 */
export class SherpaOnnxBench implements STTBenchmarkEngine {
  readonly id: string
  readonly label: string

  private bridge: PythonBridge
  private model: string

  constructor(options?: { model?: string; id?: string; label?: string }) {
    this.model = options?.model ?? 'sherpa-onnx-whisper-medium'
    this.id = options?.id ?? 'sherpa-onnx'
    this.label = options?.label ?? `Sherpa-ONNX (${this.model})`
    this.bridge = new PythonBridge(BRIDGE_SCRIPT)
  }

  async initialize(): Promise<void> {
    await this.bridge.start()
    const result = await this.bridge.send(
      { action: 'init', model: this.model },
      180_000
    )
    console.log(`[sherpa-onnx] Initialized: ${JSON.stringify(result)}`)
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
