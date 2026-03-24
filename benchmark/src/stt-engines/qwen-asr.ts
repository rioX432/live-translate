import type { STTBenchmarkEngine } from '../stt-types.js'
import { BenchmarkBridge, findPython3WithModule, getBridgePath } from './bridge-utils.js'

/**
 * Qwen3-ASR benchmark engine.
 * Supports 52 languages/dialects with SOTA accuracy.
 * Uses the qwen-asr Python bridge.
 */
export class QwenASRBench implements STTBenchmarkEngine {
  readonly id = 'qwen-asr'
  readonly label: string

  private bridge = new BenchmarkBridge('[qwen-asr]')
  private modelId: string

  constructor(variant: '0.6b' | '1.7b' = '0.6b') {
    const models: Record<string, { modelId: string; label: string }> = {
      '0.6b': { modelId: 'Qwen/Qwen3-ASR-0.6B', label: 'Qwen3-ASR (0.6B)' },
      '1.7b': { modelId: 'Qwen/Qwen3-ASR-1.7B', label: 'Qwen3-ASR (1.7B)' }
    }
    const config = models[variant]!
    this.modelId = config.modelId
    this.label = config.label
  }

  async initialize(): Promise<void> {
    if (this.bridge.isRunning) return

    const python3 = findPython3WithModule('qwen_asr', ['qwen-asr-env'])
    console.log(`[qwen-asr] Using Python: ${python3}`)

    // Check if bridge script exists; qwen-asr-bridge.py may not exist yet
    const { existsSync } = await import('fs')
    const bridgePath = getBridgePath('qwen-asr-bridge.py')
    if (!existsSync(bridgePath)) {
      throw new Error(
        `Bridge script not found: ${bridgePath}. ` +
        `Qwen3-ASR bridge is not yet implemented in resources/.`
      )
    }

    await this.bridge.start(
      python3,
      [bridgePath],
      { action: 'init', model: this.modelId }
    )
    console.log(`[qwen-asr] Ready`)
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
