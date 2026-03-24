import type { STTBenchmarkEngine } from '../stt-types.js'
import { BenchmarkBridge, findPython3WithModule, getBridgePath } from './bridge-utils.js'

/**
 * SenseVoice benchmark engine.
 * CJK-optimized STT with up to 15x faster inference than Whisper.
 * Uses the FunASR Python bridge.
 */
export class SenseVoiceBench implements STTBenchmarkEngine {
  readonly id = 'sensevoice'
  readonly label = 'SenseVoice (FunASR)'

  private bridge = new BenchmarkBridge('[sensevoice]')
  private model: string

  constructor(model = 'FunAudioLLM/SenseVoiceSmall') {
    this.model = model
  }

  async initialize(): Promise<void> {
    if (this.bridge.isRunning) return

    const python3 = findPython3WithModule('funasr', [
      'sensevoice-env',
      'funasr-env'
    ])
    console.log(`[sensevoice] Using Python: ${python3}`)

    await this.bridge.start(
      python3,
      [getBridgePath('sensevoice-bridge.py')],
      { action: 'init', model: this.model }
    )
    console.log('[sensevoice] Ready')
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
