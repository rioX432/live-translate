import { execFile } from 'child_process'
import { existsSync } from 'fs'
import type { STTBenchmarkEngine } from '../stt-types.js'

/** Well-known paths where the speech-swift `audio` binary may be installed */
const SPEECH_SWIFT_PATHS = [
  '/opt/homebrew/bin/audio',
  '/usr/local/bin/audio'
]

/**
 * Qwen3-ASR STT benchmark engine via speech-swift (Swift native, Apple Silicon).
 *
 * Uses the `audio transcribe` CLI from speech-swift (qwen3-asr-swift).
 * No Python dependency — pure Swift + MLX.
 *
 * Install: brew tap soniqo/speech https://github.com/soniqo/speech-swift && brew install speech
 */
export class Qwen3ASRSwiftBench implements STTBenchmarkEngine {
  readonly id: string
  readonly label: string

  private binaryPath: string | null = null
  private engine: string
  private model: string
  private timeoutMs: number

  constructor(options?: { variant?: '0.6b' | '1.7b'; timeoutMs?: number }) {
    const variant = options?.variant ?? '0.6b'
    this.engine = 'qwen3'
    this.model = variant === '1.7b' ? '1.7B' : '0.6B'
    this.id = `qwen3-asr-swift-${variant}`
    this.label = `Qwen3-ASR Swift ${variant.toUpperCase()}`
    this.timeoutMs = options?.timeoutMs ?? 60_000
  }

  async initialize(): Promise<void> {
    this.binaryPath = findSpeechSwiftBinary()
    if (!this.binaryPath) {
      throw new Error(
        'speech-swift `audio` binary not found. Install via: ' +
        'brew tap soniqo/speech https://github.com/soniqo/speech-swift && brew install speech'
      )
    }
    console.log(`[qwen3-asr-swift] Using binary: ${this.binaryPath}, engine: ${this.engine}`)

    // Warmup: trigger model download if needed
    console.log(`[qwen3-asr-swift] Warming up (model download on first run)...`)
    // We skip actual warmup transcription here — the first benchmark entry
    // will be warmup (handled by stt-runner's WARMUP_COUNT).
  }

  async transcribe(audioPath: string): Promise<{ text: string; language?: string }> {
    if (!this.binaryPath) {
      throw new Error('Engine not initialized')
    }

    const text = await runTranscribe(this.binaryPath, this.engine, this.model, audioPath, this.timeoutMs)

    return {
      text: text.trim(),
      language: undefined // speech-swift CLI does not output language info
    }
  }

  async dispose(): Promise<void> {
    this.binaryPath = null
  }
}

/** Find the speech-swift `audio` binary */
function findSpeechSwiftBinary(): string | null {
  for (const p of SPEECH_SWIFT_PATHS) {
    if (existsSync(p)) return p
  }
  return null
}

/** Run `audio transcribe --engine <engine> <file>` and return stdout text */
function runTranscribe(
  binaryPath: string,
  engine: string,
  model: string,
  audioPath: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['transcribe', '--engine', engine, '--model', model, audioPath]

    execFile(binaryPath, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim() || err.message
        reject(new Error(`speech-swift error: ${msg}`))
        return
      }
      // Parse "Result: <text>" line from CLI output
      const lines = stdout.split('\n')
      const resultLine = lines.find((l) => l.startsWith('Result: '))
      if (resultLine) {
        resolve(resultLine.replace('Result: ', ''))
      } else {
        // Fallback: return last non-empty line
        const lastLine = lines.filter((l) => l.trim()).pop() ?? ''
        resolve(lastLine)
      }
    })
  })
}
