/**
 * AudioWorklet processor for capturing and downsampling audio.
 *
 * Runs off the main thread. Receives raw PCM from the audio graph,
 * downsamples to 16 kHz mono via linear interpolation, and posts
 * Float32Array chunks to the main thread through the MessagePort.
 */

class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super()

    const { sourceSampleRate = 48000, targetSampleRate = 16000 } =
      options.processorOptions || {}

    this._sourceSampleRate = sourceSampleRate
    this._targetSampleRate = targetSampleRate
    this._active = true

    // Listen for stop signal from the main thread
    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'stop') {
        this._active = false
      }
    }
  }

  /**
   * Downsample audio from source sample rate to target sample rate
   * using linear interpolation.
   */
  _downsample(buffer) {
    const fromRate = this._sourceSampleRate
    const toRate = this._targetSampleRate

    if (fromRate === toRate) {
      return buffer
    }

    const ratio = fromRate / toRate
    const newLength = Math.round(buffer.length / ratio)
    const result = new Float32Array(newLength)

    for (let i = 0; i < newLength; i++) {
      const srcIndex = i * ratio
      const low = Math.floor(srcIndex)
      const high = Math.min(low + 1, buffer.length - 1)
      const frac = srcIndex - low
      result[i] = buffer[low] * (1 - frac) + buffer[high] * frac
    }

    return result
  }

  /**
   * Called by the Web Audio engine for each 128-sample render quantum.
   * Returns true to keep the processor alive, false to stop.
   */
  process(inputs) {
    if (!this._active) {
      return false
    }

    const input = inputs[0]
    if (!input || input.length === 0 || !input[0]) {
      return true
    }

    // Take the first channel (mono)
    const channelData = input[0]

    // Downsample to target rate
    const resampled = this._downsample(channelData)

    // Transfer to main thread via MessagePort
    this.port.postMessage(
      { type: 'audio', samples: resampled.buffer },
      [resampled.buffer]
    )

    return true
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor)
