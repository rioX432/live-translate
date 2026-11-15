/**
 * Level gate applied before STT. Whisper-family models invent text for silence
 * and room noise (audit §2.1-8), so rejecting such audio by energy is safer
 * than dropping recognized text by phrase, which also drops real short replies.
 */

/** Analysis frame length (ms) */
const FRAME_MS = 20

/**
 * Loudest 20ms frame must reach this RMS (about -46 dBFS) to count as speech.
 * Quiet speech through a laptop microphone peaks well above it; an idle room or
 * a muted line stays below it.
 */
export const LOW_ENERGY_PEAK_RMS = 0.005

/** RMS of the loudest frame in the buffer */
export function peakFrameRms(audio: Float32Array, sampleRate: number): number {
  const frame = Math.max(1, Math.round((sampleRate * FRAME_MS) / 1000))
  let peak = 0
  for (let start = 0; start < audio.length; start += frame) {
    const end = Math.min(audio.length, start + frame)
    let sum = 0
    for (let i = start; i < end; i++) sum += audio[i] * audio[i]
    const rms = Math.sqrt(sum / (end - start))
    if (rms > peak) peak = rms
  }
  return peak
}

/** Whether the buffer is too quiet to contain speech */
export function isLowEnergy(audio: Float32Array, sampleRate: number): boolean {
  return audio.length === 0 || peakFrameRms(audio, sampleRate) < LOW_ENERGY_PEAK_RMS
}
