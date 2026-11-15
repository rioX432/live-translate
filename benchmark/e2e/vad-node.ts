/**
 * Node replica of the renderer's MicVAD: the same vad-web FrameProcessor and
 * Silero legacy model, run through onnxruntime-node instead of the WASM build.
 */
import { readFileSync } from 'fs'
import { createRequire } from 'module'
import { dirname, join } from 'path'

const require = createRequire(__filename)
const ort = require('onnxruntime-node')
const vadDist = dirname(require.resolve('@ricky0123/vad-web/dist/index.js'))
const { FrameProcessor } = require(join(vadDist, 'frame-processor.js'))
const { SileroLegacy } = require(join(vadDist, 'models/legacy.js'))
const { Message } = require(join(vadDist, 'messages.js'))

export const SAMPLE_RATE = 16000
/** vad-web uses 1536-sample frames for the legacy model (96 ms). */
export const FRAME_SAMPLES = 1536
export const MS_PER_FRAME = (FRAME_SAMPLES / SAMPLE_RATE) * 1000

/** Values from src/renderer/hooks/useAudioCapture.ts; preSpeechPadMs keeps the library default. */
export const RENDERER_VAD_OPTIONS = {
  positiveSpeechThreshold: 0.25,
  negativeSpeechThreshold: 0.1,
  redemptionMs: 800,
  minSpeechMs: 250,
  preSpeechPadMs: 800,
  submitUserSpeechOnPause: false
}

export interface VadHandlers {
  onFrameProcessed(frame: Float32Array): void
  onSpeechStart(): void
  onSpeechEnd(audio: Float32Array): void
  onMisfire(): void
}

export class NodeVad {
  private constructor(private readonly processor: { process: Function; resume: () => void }) {}

  static async create(): Promise<NodeVad> {
    const modelPath = join(vadDist, 'silero_vad_legacy.onnx')
    const model = await SileroLegacy.new(ort, async () => readFileSync(modelPath))
    const processor = new FrameProcessor(model.process, model.reset_state, RENDERER_VAD_OPTIONS, MS_PER_FRAME)
    processor.resume()
    return new NodeVad(processor)
  }

  /** Events fire in vad-web's order: FrameProcessed before SpeechStart for the same frame. */
  async process(frame: Float32Array, h: VadHandlers): Promise<void> {
    await this.processor.process(frame, (ev: { msg: string; frame?: Float32Array; audio?: Float32Array }) => {
      switch (ev.msg) {
        case Message.FrameProcessed:
          h.onFrameProcessed(ev.frame!)
          break
        case Message.SpeechStart:
          h.onSpeechStart()
          break
        case Message.SpeechEnd:
          h.onSpeechEnd(ev.audio!)
          break
        case Message.VADMisfire:
          h.onMisfire()
          break
      }
    })
  }
}
