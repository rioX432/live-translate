import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { execFileSync } from 'child_process'
import type { STTBenchmarkEngine } from '../stt-types.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MODELS_DIR = join(__dirname, '..', '..', 'models')

/**
 * Local Whisper STT benchmark engine.
 * Uses whisper.cpp CLI directly (avoids whisper-node-addon Electron dependency).
 */
export class WhisperLocalBench implements STTBenchmarkEngine {
  readonly id = 'whisper-local'
  readonly label = 'Whisper.cpp (Local)'

  private modelPath: string
  private whisperBin: string

  constructor(options?: { modelPath?: string; whisperBin?: string }) {
    this.modelPath =
      options?.modelPath ?? join(MODELS_DIR, 'ggml-large-v3-turbo-q5_0.bin')
    this.whisperBin = options?.whisperBin ?? 'whisper-cpp'
  }

  async initialize(): Promise<void> {
    if (!existsSync(this.modelPath)) {
      throw new Error(
        `Whisper model not found: ${this.modelPath}\n` +
          'Download from: https://huggingface.co/ggerganov/whisper.cpp/tree/main'
      )
    }

    // Verify whisper-cpp binary is available
    try {
      execFileSync(this.whisperBin, ['--help'], { stdio: 'pipe', timeout: 5000 })
    } catch {
      throw new Error(
        `whisper-cpp binary not found at '${this.whisperBin}'.\n` +
          'Install: brew install whisper-cpp  OR  set whisperBin option to the binary path.'
      )
    }

    console.log(`[whisper-local] Model: ${this.modelPath}`)
  }

  async transcribe(audioPath: string): Promise<{ text: string; language?: string }> {
    const args = [
      '--model', this.modelPath,
      '--file', audioPath,
      '--language', 'auto',
      '--output-txt',
      '--no-timestamps',
      '--threads', '4'
    ]

    try {
      const output = execFileSync(this.whisperBin, args, {
        encoding: 'utf-8',
        timeout: 60_000,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      const text = output.trim()
      return { text }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      throw new Error(`whisper-cpp failed: ${msg}`)
    }
  }

  async dispose(): Promise<void> {
    // No persistent state to clean up
  }
}
