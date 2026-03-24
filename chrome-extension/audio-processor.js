/**
 * AudioWorkletProcessor that collects mono audio samples and posts them
 * to the main thread in batches.
 *
 * Each `process()` call receives 128 frames. We accumulate them and
 * post a message once we have collected enough for one processing chunk
 * (4096 samples, matching the previous ScriptProcessorNode buffer size).
 */
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Float32Array(4096)
    this._offset = 0
  }

  /**
   * Called by the audio rendering thread for every 128-frame quantum.
   * @param {Float32Array[][]} inputs  - input audio data
   * @returns {boolean} true to keep the processor alive
   */
  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) {
      return true
    }

    const channelData = input[0]
    if (!channelData) {
      return true
    }

    let srcOffset = 0
    while (srcOffset < channelData.length) {
      const remaining = this._buffer.length - this._offset
      const toCopy = Math.min(remaining, channelData.length - srcOffset)

      this._buffer.set(channelData.subarray(srcOffset, srcOffset + toCopy), this._offset)
      this._offset += toCopy
      srcOffset += toCopy

      if (this._offset >= this._buffer.length) {
        // Post a copy of the filled buffer to the main thread
        this.port.postMessage({ audioData: Array.from(this._buffer) })
        this._offset = 0
      }
    }

    return true
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor)
