import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { SpeakerDiarizer, DiarizationResult } from '../types'
import {
  FLUID_AUDIO_DIARIZE_TIMEOUT_MS,
  FLUID_AUDIO_INIT_TIMEOUT_MS
} from '../constants'
import { SubprocessBridge } from '../SubprocessBridge'
import type { SpawnConfig, InitResult } from '../SubprocessBridge'

/**
 * Well-known paths where the fluid-audio-bridge binary may be installed.
 * Users build from scripts/fluid-audio/ and place the binary in their PATH.
 */
const FLUID_AUDIO_PATHS = [
  '/opt/homebrew/bin/fluid-audio-bridge',
  '/usr/local/bin/fluid-audio-bridge'
]

/**
 * FluidAudio speaker diarization engine (CoreML native, macOS only).
 *
 * Uses FluidAudio's OfflineDiarizerManager via a Swift CLI bridge
 * (scripts/fluid-audio) that communicates via JSON-over-stdio.
 *
 * Components: Silero VAD v5 + pyannote segmentation 3.0 + WeSpeaker ResNet34
 * Performance: ~40μs/chunk on M2 Max, ~32MB total model size
 *
 * Runs in parallel with STT on the same audio buffer to identify the
 * dominant speaker in each chunk. Speaker labels are merged with
 * STT results in StreamingProcessor for color-coded subtitles.
 *
 * Build the CLI:
 *   cd scripts/fluid-audio && swift build -c release
 *   cp .build/release/fluid-audio-bridge /opt/homebrew/bin/
 *
 * Experimental: requires separate FluidAudio installation.
 */
export class FluidAudioDiarizer extends SubprocessBridge implements SpeakerDiarizer {
  readonly id = 'fluid-audio'
  readonly name = 'FluidAudio (CoreML)'

  private onProgress?: (message: string) => void
  private threshold: number

  constructor(options?: {
    /** Speaker clustering threshold (default: 0.6) */
    threshold?: number
    onProgress?: (message: string) => void
  }) {
    super()
    this.threshold = options?.threshold ?? 0.6
    this.onProgress = options?.onProgress
  }

  protected getLogPrefix(): string {
    return '[fluid-audio]'
  }

  protected getInitTimeout(): number {
    return FLUID_AUDIO_INIT_TIMEOUT_MS
  }

  protected getCommandTimeout(): number {
    return FLUID_AUDIO_DIARIZE_TIMEOUT_MS
  }

  protected getSpawnConfig(): SpawnConfig {
    const binaryPath = findFluidAudioBinary()
    if (!binaryPath) {
      throw new Error(
        'fluid-audio-bridge binary not found. Build from scripts/fluid-audio: ' +
        'cd scripts/fluid-audio && swift build -c release && ' +
        'cp .build/release/fluid-audio-bridge /opt/homebrew/bin/'
      )
    }

    return {
      command: binaryPath,
      args: [],
      initMessage: {
        action: 'init',
        threshold: this.threshold
      }
    }
  }

  protected onStatusMessage(status: string): void {
    this.onProgress?.(status)
  }

  protected onInitComplete(result: InitResult): void {
    if (result.status !== 'ready') {
      throw new Error(`FluidAudio init returned unexpected status: ${result.status}`)
    }
    this.log.info('FluidAudio diarizer ready')
    this.onProgress?.('Speaker diarization ready (FluidAudio)')
  }

  protected getSpawnError(): Error {
    return new Error(
      'Failed to start fluid-audio-bridge. ' +
      'Build from scripts/fluid-audio: cd scripts/fluid-audio && swift build -c release && ' +
      'cp .build/release/fluid-audio-bridge /opt/homebrew/bin/'
    )
  }

  async processAudio(
    audioChunk: Float32Array,
    sampleRate: number
  ): Promise<DiarizationResult | null> {
    if (!this.process) return null

    const tempPath = join(tmpdir(), `fluid-audio-${Date.now()}.wav`)
    try {
      writeWav(tempPath, audioChunk, sampleRate)

      const result = await this.sendCommand({
        action: 'diarize',
        audioPath: tempPath
      })

      if (result.error) {
        this.log.warn('Diarization error:', result.error)
        return null
      }

      if (!result.speakerLabel) return null

      return {
        speakerLabel: result.speakerLabel as string,
        speakerIndex: result.speakerIndex as number,
        confidence: result.confidence as number
      }
    } catch (err) {
      this.log.warn('Diarization failed (non-fatal):', err instanceof Error ? err.message : err)
      return null
    } finally {
      try { unlinkSync(tempPath) } catch { /* ignore */ }
    }
  }
}

/** Find the fluid-audio-bridge binary in well-known paths */
function findFluidAudioBinary(): string | null {
  for (const p of FLUID_AUDIO_PATHS) {
    if (existsSync(p)) return p
  }
  return null
}

/** Write Float32Array as a minimal WAV file */
function writeWav(path: string, samples: Float32Array, sampleRate: number): void {
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const dataSize = samples.length * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  // WAV header
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28)
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  // Convert Float32 [-1, 1] to Int16
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }

  writeFileSync(path, buffer)
}
