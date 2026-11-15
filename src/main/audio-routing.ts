import { createLogger } from './logger'
import { SAMPLE_RATE } from './constants'
import { MIN_AUDIO_CHUNK_SAMPLES } from './audio-constants'
import type { AppContext } from './app-context'
import type { TranslationResult } from '../engines/types'

const log = createLogger('audio')

export type AudioMessageKind = 'interim' | 'final'

/** One piece of audio for one speech segment, as sent by the renderer. */
export interface AudioMessage {
  kind: AudioMessageKind
  segmentId: string
  audio: Float32Array
  /** Wall-clock ms (Date.now()) when the last speech frame of the segment was heard. */
  speechEndedAt?: number
}

const SEGMENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

/** Convert renderer audio (number[] over IPC, ArrayBuffer over MessagePort) to Float32Array. */
export function toFloat32(audio: unknown): Float32Array | null {
  if (audio instanceof Float32Array) return audio
  if (Array.isArray(audio)) return new Float32Array(audio)
  if (Buffer.isBuffer(audio)) {
    return new Float32Array(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength))
  }
  if (audio instanceof ArrayBuffer) return new Float32Array(audio)
  return null
}

/** Validate an untyped renderer payload `{ segmentId, audio, speechEndedAt? }`. */
export function parseAudioMessage(kind: AudioMessageKind, payload: unknown): AudioMessage | null {
  if (!payload || typeof payload !== 'object') return null
  const { segmentId, audio, speechEndedAt } = payload as Record<string, unknown>
  if (typeof segmentId !== 'string' || !SEGMENT_ID_PATTERN.test(segmentId)) return null
  const samples = toFloat32(audio)
  if (!samples) return null
  const endedAt = typeof speechEndedAt === 'number' && Number.isFinite(speechEndedAt) ? speechEndedAt : undefined
  return { kind, segmentId, audio: samples, ...(endedAt !== undefined && { speechEndedAt: endedAt }) }
}

/**
 * Hand one segment's audio to the pipeline. The pipeline serializes STT calls
 * itself, so nothing is dropped here for being concurrent. Finals are always
 * forwarded, even short or quiet ones: the pipeline must see every final to
 * close the segment (and clear its interim subtitle).
 */
export async function routeAudio(
  ctx: AppContext,
  msg: AudioMessage,
  via: 'port' | 'ipc' | 'ws'
): Promise<TranslationResult | null> {
  const pipeline = ctx.pipeline
  if (!pipeline?.running) return null
  const seconds = (msg.audio.length / SAMPLE_RATE).toFixed(1)
  try {
    if (msg.kind === 'interim') {
      // Too little audio for a useful hypothesis; the next interim will carry more.
      if (msg.audio.length < MIN_AUDIO_CHUNK_SAMPLES) return null
      return await pipeline.processStreaming(msg.audio, SAMPLE_RATE, msg.segmentId)
    }
    log.info(`final ${msg.segmentId} received via ${via}: ${seconds}s audio`)
    return await pipeline.finalizeStreaming(msg.audio, SAMPLE_RATE, msg.segmentId, {
      speechEndedAt: msg.speechEndedAt
    })
  } catch (err) {
    log.error(`${msg.kind} ${msg.segmentId} failed (${via}):`, err instanceof Error ? err.message : String(err))
    return null
  }
}
