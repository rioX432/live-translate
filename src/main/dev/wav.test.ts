import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readWav } from './wav'

const dirs: string[] = []

function tempFile(name: string, buffer: Buffer): string {
  const dir = mkdtempSync(join(tmpdir(), 'wav-test-'))
  dirs.push(dir)
  const path = join(dir, name)
  writeFileSync(path, buffer)
  return path
}

/** Build a minimal RIFF/WAVE file around the given PCM16 samples. */
function buildWav(samples: number[], { channels = 1, bitsPerSample = 16, sampleRate = 16000 } = {}): Buffer {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((s, i) => data.writeInt16LE(s, i * 2))

  const header = Buffer.alloc(44)
  header.write('RIFF', 0, 'ascii')
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8, 'ascii')
  header.write('fmt ', 12, 'ascii')
  header.writeUInt32LE(16, 16) // fmt chunk size
  header.writeUInt16LE(1, 20) // PCM
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28)
  header.writeUInt16LE(channels * (bitsPerSample / 8), 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36, 'ascii')
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

describe('readWav', () => {
  it('parses 16-bit mono PCM into normalized float samples', () => {
    const path = tempFile('ok.wav', buildWav([0, 16384, -16384, 32767]))

    const { samples, sampleRate } = readWav(path)

    expect(sampleRate).toBe(16000)
    expect(Array.from(samples)).toEqual([0, 0.5, -0.5, 32767 / 32768])
  })

  it('reads the declared sample rate rather than assuming 16kHz', () => {
    const path = tempFile('24k.wav', buildWav([1, 2], { sampleRate: 24000 }))

    expect(readWav(path).sampleRate).toBe(24000)
  })

  it('skips unknown chunks before the data chunk', () => {
    const base = buildWav([1234])
    // Splice a LIST chunk between "fmt " and "data" — common in real recordings.
    const list = Buffer.alloc(12)
    list.write('LIST', 0, 'ascii')
    list.writeUInt32LE(4, 4)
    list.write('INFO', 8, 'ascii')
    const withList = Buffer.concat([base.subarray(0, 36), list, base.subarray(36)])
    withList.writeUInt32LE(withList.length - 8, 4)

    const { samples } = readWav(tempFile('list.wav', withList))

    expect(Array.from(samples)).toEqual([1234 / 32768])
  })

  it('rejects non-WAV, stereo, and non-16-bit files instead of decoding garbage', () => {
    expect(() => readWav(tempFile('small.wav', Buffer.alloc(10)))).toThrow(/too small/)

    const notRiff = buildWav([1])
    notRiff.write('JUNK', 0, 'ascii')
    expect(() => readWav(tempFile('junk.wav', notRiff))).toThrow(/RIFF/)

    expect(() => readWav(tempFile('stereo.wav', buildWav([1, 2], { channels: 2 })))).toThrow(/mono/)
    expect(() => readWav(tempFile('8bit.wav', buildWav([1], { bitsPerSample: 8 })))).toThrow(/16-bit/)
  })

  it('does not read past the end of a file whose data chunk over-declares its size', () => {
    const truncated = buildWav([1, 2, 3])
    truncated.writeUInt32LE(9999, 40) // data chunk claims far more than is present

    const { samples } = readWav(tempFile('truncated.wav', truncated))

    expect(samples.length).toBe(3)
  })
})
