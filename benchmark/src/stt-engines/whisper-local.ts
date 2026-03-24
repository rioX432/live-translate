import type { STTBenchmarkEngine } from '../stt-types.js'

/**
 * Whisper Local benchmark engine using whisper-node-addon (native).
 *
 * Note: whisper-node-addon requires native bindings that may only work
 * inside the Electron context. This engine attempts a direct require()
 * but will fail gracefully if the addon is not available.
 */
export class WhisperLocalBench implements STTBenchmarkEngine {
  readonly id = 'whisper-local'
  readonly label = 'Whisper Local (native)'

  private whisperModule: {
    transcribe: (opts: Record<string, unknown>) => Promise<{ transcription: string[][] | string[] }>
  } | null = null
  private modelPath = ''

  async initialize(): Promise<void> {
    if (this.whisperModule) return

    try {
      // whisper-node-addon is a native addon — may not be available outside Electron
      this.whisperModule = await import('@kutalia/whisper-node-addon')
    } catch (err) {
      throw new Error(
        `whisper-node-addon not available. This engine requires the native addon. ` +
        `Error: ${err instanceof Error ? err.message : err}`
      )
    }

    // Find model path — check common locations
    const { existsSync } = await import('fs')
    const { join } = await import('path')
    const { homedir } = await import('os')

    const candidates = [
      join(homedir(), 'Library', 'Application Support', 'live-translate', 'models', 'ggml-large-v3-turbo.bin'),
      join(homedir(), 'Library', 'Application Support', 'live-translate', 'models', 'ggml-kotoba-whisper-v2.0.bin'),
      join(homedir(), '.cache', 'whisper', 'ggml-large-v3-turbo.bin'),
      join(homedir(), '.cache', 'whisper', 'ggml-base.bin')
    ]

    for (const p of candidates) {
      if (existsSync(p)) {
        this.modelPath = p
        console.log(`[whisper-local] Using model: ${p}`)
        return
      }
    }

    throw new Error(
      'Whisper model not found. Download a ggml model to ~/Library/Application Support/live-translate/models/'
    )
  }

  async transcribe(audioPath: string, _language?: string): Promise<string> {
    if (!this.whisperModule || !this.modelPath) {
      throw new Error('Engine not initialized')
    }

    // Read WAV file and extract PCM samples
    const pcmf32 = await readWavAsPcm(audioPath)

    const result = await this.whisperModule.transcribe({
      model: this.modelPath,
      pcmf32,
      language: 'auto',
      vad: false,
      no_timestamps: true,
      no_prints: true
    })

    return extractText(result.transcription)
  }

  async dispose(): Promise<void> {
    this.whisperModule = null
    this.modelPath = ''
  }
}

/** Read a WAV file and return Float32Array of samples */
async function readWavAsPcm(wavPath: string): Promise<Float32Array> {
  const { readFileSync } = await import('fs')
  const buffer = readFileSync(wavPath)

  // Parse WAV header
  const dataOffset = 44 // Standard WAV header size
  const bitsPerSample = buffer.readUInt16LE(34)
  const numSamples = (buffer.length - dataOffset) / (bitsPerSample / 8)

  const samples = new Float32Array(numSamples)
  for (let i = 0; i < numSamples; i++) {
    if (bitsPerSample === 16) {
      samples[i] = buffer.readInt16LE(dataOffset + i * 2) / 32768.0
    } else if (bitsPerSample === 32) {
      samples[i] = buffer.readFloatLE(dataOffset + i * 4)
    }
  }

  return samples
}

/** Extract text from whisper-node-addon transcription result */
function extractText(transcription: string[][] | string[]): string {
  if (!transcription || transcription.length === 0) return ''
  if (Array.isArray(transcription[0])) {
    return (transcription as string[][]).map((seg) => seg[seg.length - 1] || '').join(' ').trim()
  }
  return (transcription as string[]).join(' ').trim()
}
