import type { STTEngine, STTResult } from '../types'
import { createLogger } from '../../main/logger'

const log = createLogger('onnx-web-stt')

/**
 * ONNX Runtime Web Whisper STT engine stub (#556).
 *
 * TODO: Implement Whisper ONNX inference via @huggingface/transformers
 * with WebGPU/WASM execution providers. This would provide a universal
 * fallback STT when whisper-node-addon native build fails.
 *
 * Known issues to address before implementation:
 * - WebGPU + q8 decoder produces gibberish (Transformers.js #1317)
 * - Whisper ONNX models are large (~150MB for tiny, ~1.5GB for small)
 * - Real-time streaming requires chunked inference in main process
 * - Need to benchmark latency vs native whisper.cpp path
 *
 * Execution provider hierarchy (same as OnnxWebTranslator):
 *   1. WebGPU  — GPU acceleration
 *   2. WASM    — universal CPU fallback
 */
export class OnnxWebSTTEngine implements STTEngine {
  readonly id = 'onnx-web-stt'
  readonly name = 'Whisper ONNX Web (Experimental)'
  readonly isOffline = true

  async initialize(): Promise<void> {
    log.warn('OnnxWebSTTEngine is a stub — not yet implemented')
    throw new Error(
      'OnnxWebSTTEngine is not yet implemented. ' +
      'Use WhisperLocalEngine or MlxWhisperEngine instead.'
    )
  }

  async processAudio(_audioChunk: Float32Array, _sampleRate: number): Promise<STTResult | null> {
    // Stub — will return null (no speech) until implemented
    return null
  }

  async dispose(): Promise<void> {
    log.info('Disposing resources')
  }
}
