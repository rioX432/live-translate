import { execFile, execSync } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'
import type { STTBenchmarkEngine } from '../stt-types.js'

/** Well-known paths where the qwen_asr binary may be installed */
const QWEN_ASR_BINARY_PATHS = [
  '/opt/homebrew/bin/qwen_asr',
  '/usr/local/bin/qwen_asr',
  join(homedir(), 'qwen-asr', 'qwen_asr')
]

/**
 * Qwen3-ASR STT benchmark engine via antirez/qwen-asr pure C implementation.
 *
 * Uses the `qwen_asr` CLI binary compiled from https://github.com/antirez/qwen-asr.
 * Pure C with only BLAS dependency (Accelerate on macOS, OpenBLAS on Linux).
 * Models use safetensors format with memory-mapped loading for near-instant startup.
 *
 * Cross-platform (macOS + Linux), no Python/Swift dependency.
 *
 * Install:
 *   git clone https://github.com/antirez/qwen-asr
 *   cd qwen-asr && make blas
 *   ./download_model.sh   # Select 0.6B or 1.7B
 */
export class Qwen3ASRNativeBench implements STTBenchmarkEngine {
  readonly id: string
  readonly label: string

  private binaryPath: string | null = null
  private modelDir: string | null = null
  private variant: '0.6b' | '1.7b'
  private timeoutMs: number

  constructor(options?: { variant?: '0.6b' | '1.7b'; timeoutMs?: number }) {
    this.variant = options?.variant ?? '0.6b'
    this.id = `qwen3-asr-native-${this.variant}`
    this.label = `Qwen3-ASR Native ${this.variant.toUpperCase()}`
    this.timeoutMs = options?.timeoutMs ?? 60_000
  }

  async initialize(): Promise<void> {
    this.binaryPath = findQwenAsrBinary()
    if (!this.binaryPath) {
      throw new Error(
        'qwen_asr binary not found. Build from source:\n' +
        '  git clone https://github.com/antirez/qwen-asr\n' +
        '  cd qwen-asr && make blas\n' +
        '  ./download_model.sh'
      )
    }
    console.log(`[qwen3-asr-native] Using binary: ${this.binaryPath}`)

    const dirName = this.variant === '1.7b' ? 'qwen3-asr-1.7b' : 'qwen3-asr-0.6b'
    this.modelDir = findModelDir(this.binaryPath, dirName)
    if (!this.modelDir) {
      throw new Error(
        `Model directory '${dirName}' not found. Download the model:\n` +
        `  cd ${getDirname(this.binaryPath)} && ./download_model.sh`
      )
    }
    console.log(`[qwen3-asr-native] Model directory: ${this.modelDir}`)
  }

  async transcribe(audioPath: string): Promise<{ text: string; language?: string }> {
    if (!this.binaryPath || !this.modelDir) {
      throw new Error('Engine not initialized')
    }

    const text = await runTranscribe(
      this.binaryPath,
      this.modelDir,
      audioPath,
      this.timeoutMs
    )

    return {
      text: text.trim(),
      language: undefined // qwen_asr CLI does not output language info
    }
  }

  async dispose(): Promise<void> {
    this.binaryPath = null
    this.modelDir = null
  }
}

/** Find the qwen_asr binary in well-known locations or PATH */
function findQwenAsrBinary(): string | null {
  for (const p of QWEN_ASR_BINARY_PATHS) {
    if (existsSync(p)) {
      try {
        execSync(`"${p}" --help`, { stdio: 'ignore', timeout: 5000 })
        return p
      } catch {
        // Binary exists but not usable
      }
    }
  }

  // Try PATH lookup
  try {
    const which = execSync('which qwen_asr', { encoding: 'utf-8', timeout: 3000 }).trim()
    if (which && existsSync(which)) return which
  } catch { /* not in PATH */ }

  return null
}

/**
 * Find the model directory relative to the binary or in common locations.
 * antirez/qwen-asr expects the model dir to contain safetensors files.
 */
function findModelDir(binaryPath: string, dirName: string): string | null {
  const candidates = [
    join(getDirname(binaryPath), dirName),
    join(homedir(), 'qwen-asr', dirName),
    join(homedir(), '.cache', 'qwen-asr', dirName),
    join('/opt/homebrew/share/qwen-asr', dirName),
    join('/usr/local/share/qwen-asr', dirName)
  ]

  for (const dir of candidates) {
    if (existsSync(dir)) {
      try {
        const files = readdirSync(dir)
        const hasModel = files.some(
          (f) => f.endsWith('.safetensors') || f.endsWith('.bin') || f === 'config.json'
        )
        if (hasModel) return dir
      } catch { /* ignore read errors */ }
    }
  }

  return null
}

/** Get directory name from a file path */
function getDirname(p: string): string {
  const parts = p.split('/')
  parts.pop()
  return parts.join('/') || '/'
}

/** Run `qwen_asr -d <model_dir> -i <wav_file> --silent` and return transcribed text */
function runTranscribe(
  binaryPath: string,
  modelDir: string,
  audioPath: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = ['-d', modelDir, '-i', audioPath, '--silent']

    execFile(binaryPath, args, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        const msg = stderr?.trim() || err.message
        reject(new Error(`qwen_asr error: ${msg}`))
        return
      }

      // Output is the transcribed text on stdout
      resolve(stdout.trim())
    })
  })
}
