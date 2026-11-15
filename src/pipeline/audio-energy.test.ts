import { describe, it, expect } from 'vitest'
import { isLowEnergy, peakFrameRms, LOW_ENERGY_PEAK_RMS } from './audio-energy'

function tone(amplitude: number, seconds: number, sampleRate = 16000): Float32Array {
  const out = new Float32Array(Math.round(sampleRate * seconds))
  for (let i = 0; i < out.length; i++) out[i] = amplitude * Math.sin((2 * Math.PI * 220 * i) / sampleRate)
  return out
}

describe('isLowEnergy', () => {
  it('treats silence and an empty buffer as no speech', () => {
    expect(isLowEnergy(new Float32Array(16000), 16000)).toBe(true)
    expect(isLowEnergy(new Float32Array(0), 16000)).toBe(true)
  })

  it('treats faint noise below the gate as no speech', () => {
    expect(isLowEnergy(tone(0.003, 1), 16000)).toBe(true)
  })

  it('passes quiet speech-level audio', () => {
    expect(isLowEnergy(tone(0.02, 1), 16000)).toBe(false)
  })

  it('passes a short burst of speech inside a mostly silent buffer', () => {
    const audio = new Float32Array(16000 * 2)
    audio.set(tone(0.05, 0.2), 16000)
    expect(isLowEnergy(audio, 16000)).toBe(false)
    expect(peakFrameRms(audio, 16000)).toBeGreaterThan(LOW_ENERGY_PEAK_RMS)
  })
})
