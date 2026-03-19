import { spawn, type ChildProcess } from 'child_process'
import { join } from 'path'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'

interface SpeakerSegment {
  speaker: string
  start: number
  end: number
}

const DIARIZE_TIMEOUT_MS = 60_000

/**
 * Pyannote.audio diarization via Python subprocess bridge.
 * Requires: pip install pyannote.audio
 * Requires: HuggingFace auth token with access to pyannote models
 */
export class PyannoteDiarizer {
  private process: ChildProcess | null = null
  private pendingRequests = new Map<number, { resolve: (data: any) => void; timeout: ReturnType<typeof setTimeout> }>()
  private nextRequestId = 0
  private buffer = ''

  async initialize(authToken?: string): Promise<void> {
    if (this.process) return

    const bridgePath = join(__dirname, '../../resources/pyannote-bridge.py')

    try {
      this.process = spawn('python3', [bridgePath], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
    } catch {
      throw new Error('Python 3 not found. Install Python 3 and run: pip install pyannote.audio')
    }

    this.process.on('error', (err) => {
      console.error('[pyannote] Bridge error:', err.message)
      this.process = null
    })

    this.process.stdout!.on('data', (data: Buffer) => {
      this.buffer += data.toString()
      const lines = this.buffer.split('\n')
      this.buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.trim()) continue
        try {
          const msg = JSON.parse(line)
          const reqId = msg._reqId as number | undefined
          if (reqId !== undefined && this.pendingRequests.has(reqId)) {
            const req = this.pendingRequests.get(reqId)!
            clearTimeout(req.timeout)
            req.resolve(msg)
            this.pendingRequests.delete(reqId)
          }
        } catch {
          console.warn('[pyannote] Invalid JSON:', line)
        }
      }
    })

    this.process.stderr!.on('data', (data: Buffer) => {
      console.warn('[pyannote] stderr:', data.toString().trim())
    })

    this.process.on('exit', (code) => {
      console.log(`[pyannote] Bridge exited with code ${code}`)
      this.process = null
    })

    const result = await this.sendCommand({ action: 'init', auth_token: authToken })
    if (result.error) {
      throw new Error(`pyannote init failed: ${result.error}`)
    }
  }

  async diarize(audioChunk: Float32Array, sampleRate: number): Promise<SpeakerSegment[]> {
    if (!this.process) return []

    const tempPath = join(tmpdir(), `pyannote-${Date.now()}.wav`)
    try {
      writeWav(tempPath, audioChunk, sampleRate)
      const result = await this.sendCommand({ action: 'diarize', audio_path: tempPath })
      if (result.error) {
        console.error('[pyannote] Diarization error:', result.error)
        return []
      }
      return result.speakers || []
    } finally {
      try { unlinkSync(tempPath) } catch { /* ignore */ }
    }
  }

  async dispose(): Promise<void> {
    console.log('[pyannote] Disposing resources')
    // Reject all pending requests
    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timeout)
      req.resolve({ error: 'Diarizer disposed' })
    }
    this.pendingRequests.clear()

    if (this.process) {
      try {
        this.sendCommand({ action: 'dispose' }).catch(() => {})
        await new Promise((resolve) => setTimeout(resolve, 500))
      } catch { /* ignore */ }
      try { this.process.kill() } catch { /* ignore */ }
      this.process = null
    }
  }

  private sendCommand(cmd: Record<string, unknown>): Promise<any> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        reject(new Error('Bridge not running'))
        return
      }

      const reqId = this.nextRequestId++
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(reqId)
        reject(new Error('Diarization timed out'))
      }, DIARIZE_TIMEOUT_MS)

      this.pendingRequests.set(reqId, { resolve: (data) => {
        clearTimeout(timeout)
        resolve(data)
      }, timeout })

      this.process.stdin.write(JSON.stringify({ ...cmd, _reqId: reqId }) + '\n')
    })
  }
}

function writeWav(path: string, samples: Float32Array, sampleRate: number): void {
  const numChannels = 1
  const bitsPerSample = 16
  const bytesPerSample = bitsPerSample / 8
  const dataSize = samples.length * bytesPerSample
  const buffer = Buffer.alloc(44 + dataSize)

  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataSize, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20)
  buffer.writeUInt16LE(numChannels, 22)
  buffer.writeUInt32LE(sampleRate, 24)
  buffer.writeUInt32LE(sampleRate * numChannels * bytesPerSample, 28)
  buffer.writeUInt16LE(numChannels * bytesPerSample, 32)
  buffer.writeUInt16LE(bitsPerSample, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataSize, 40)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    buffer.writeInt16LE(Math.round(s * 32767), 44 + i * 2)
  }

  writeFileSync(path, buffer)
}
