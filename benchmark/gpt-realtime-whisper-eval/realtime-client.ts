/**
 * Thin OpenAI Realtime transcription client used by the GPT-Realtime-Whisper
 * benchmark.
 *
 * The transcription session protocol (verified against developers.openai.com
 * docs in 2026-06):
 *   - WebSocket URL: wss://api.openai.com/v1/realtime?model=gpt-realtime-whisper
 *     (the connection-time model query parameter selects the transcription
 *     entry point; a session.update event then sets the transcription-specific
 *     options).
 *   - Authorization: Bearer <OPENAI_API_KEY>
 *   - Configure with a "session.update" event whose payload is
 *     { session: { type: "transcription", audio: { input: { format, transcription, turn_detection } } } }.
 *   - Send PCM via "input_audio_buffer.append" (base64 string).
 *   - With turn_detection disabled, commit explicitly with
 *     "input_audio_buffer.commit" and wait for
 *     "conversation.item.input_audio_transcription.completed".
 *
 * Sources:
 *   - https://developers.openai.com/api/docs/guides/realtime-transcription
 *   - https://developers.openai.com/api/docs/guides/realtime-websocket
 *
 * This module is intentionally framework-free — it relies on the global
 * WebSocket constructor available in Node 22+ (and Electron 33+).
 */

import { Buffer } from 'node:buffer'

export type LatencyTier = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface TranscribeOptions {
  apiKey: string
  /** Either "ja" or "en" to provide a language hint, or undefined for auto. */
  languageHint?: 'ja' | 'en'
  /** Documented latency tier. Default "low" matches live-translate's 3 s chunks. */
  latency?: LatencyTier
  /** PCM16 mono samples at 24 kHz (the documented Realtime input format). */
  pcm16At24kHz: Buffer
  /** Wall-clock timeout for a single transcription. */
  timeoutMs?: number
  /** Override the WebSocket endpoint (used in tests). */
  endpoint?: string
}

export interface TranscribeResult {
  /** Final transcript. */
  text: string
  /** Wall-clock time-to-first-delta in milliseconds, undefined if no delta arrived. */
  ttfdMs?: number
  /** Wall-clock time to "completed" event in milliseconds. */
  totalMs: number
}

const DEFAULT_ENDPOINT = 'wss://api.openai.com/v1/realtime?model=gpt-realtime-whisper'
const DEFAULT_TIMEOUT_MS = 60_000
const MAX_APPEND_CHUNK_BYTES = 64 * 1024 // keep individual WebSocket frames small
const TARGET_RATE_HZ = 24_000

/**
 * Build the session.update payload sent on connect. Exposed for unit testing
 * so we can lock in the documented schema without spinning up a mock
 * WebSocket server.
 */
export function buildSessionUpdate(
  languageHint: 'ja' | 'en' | undefined,
  latency: LatencyTier
): Record<string, unknown> {
  return {
    type: 'session.update',
    session: {
      type: 'transcription',
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: TARGET_RATE_HZ },
          transcription: {
            model: 'gpt-realtime-whisper',
            ...(languageHint ? { language: languageHint } : {}),
            delay: latency
          },
          turn_detection: null
        }
      }
    }
  }
}

/**
 * Run one transcription against the GPT-Realtime-Whisper streaming endpoint.
 * Reject on timeout, transport error, or "error" event from the server.
 */
export function transcribeOnce(options: TranscribeOptions): Promise<TranscribeResult> {
  const {
    apiKey,
    languageHint,
    latency = 'low',
    pcm16At24kHz,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    endpoint = DEFAULT_ENDPOINT
  } = options

  if (!apiKey) {
    return Promise.reject(new Error('OPENAI_API_KEY is required'))
  }
  if (typeof WebSocket === 'undefined') {
    return Promise.reject(
      new Error(
        'Global WebSocket is not available. Run on Node 22+ or Electron 33+.'
      )
    )
  }

  return new Promise<TranscribeResult>((resolve, reject) => {
    // Node's WebSocket (undici-backed since 22.x) accepts an options bag as
    // second arg with custom headers. The DOM lib types do not include this,
    // so we cast through unknown here.
    const ws = new WebSocket(endpoint, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    } as unknown as string)

    const start = performance.now()
    let firstDeltaAt: number | undefined
    let finalText = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try {
        ws.close(1000, 'timeout')
      } catch {
        /* ignore */
      }
      reject(new Error(`gpt-realtime-whisper transcription timed out after ${timeoutMs}ms`))
    }, timeoutMs)

    const finish = (err: Error | null, value?: TranscribeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        ws.close()
      } catch {
        /* ignore */
      }
      if (err) reject(err)
      else if (value) resolve(value)
    }

    ws.addEventListener('open', () => {
      // Shape per developers.openai.com/api/docs/guides/realtime-transcription
      // (verified 2026-06). Manual commit because we send the entire
      // utterance in one shot.
      ws.send(JSON.stringify(buildSessionUpdate(languageHint, latency)))

      // Stream PCM in modest chunks so individual frames stay <= 64 KB.
      for (let i = 0; i < pcm16At24kHz.length; i += MAX_APPEND_CHUNK_BYTES) {
        const chunk = pcm16At24kHz.subarray(i, i + MAX_APPEND_CHUNK_BYTES)
        ws.send(
          JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: chunk.toString('base64')
          })
        )
      }
      ws.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
    })

    ws.addEventListener('message', (event: MessageEvent<unknown>) => {
      try {
        const data = event.data
        let raw: string
        if (typeof data === 'string') raw = data
        else if (data instanceof ArrayBuffer) raw = Buffer.from(data).toString('utf-8')
        else if (Buffer.isBuffer(data)) raw = data.toString('utf-8')
        else if (data instanceof Uint8Array) raw = Buffer.from(data).toString('utf-8')
        else raw = String(data)
        const msg = JSON.parse(raw) as RealtimeServerEvent
        switch (msg.type) {
          case 'conversation.item.input_audio_transcription.delta': {
            if (firstDeltaAt === undefined) firstDeltaAt = performance.now() - start
            if (typeof msg.delta === 'string') finalText += msg.delta
            break
          }
          case 'conversation.item.input_audio_transcription.completed': {
            if (typeof msg.transcript === 'string' && msg.transcript.length > 0) {
              finalText = msg.transcript
            }
            const totalMs = performance.now() - start
            finish(null, { text: finalText.trim(), ttfdMs: firstDeltaAt, totalMs })
            break
          }
          case 'error': {
            const code = msg.error?.code ? ` [${msg.error.code}]` : ''
            const message = msg.error?.message ?? 'unknown error'
            finish(new Error(`gpt-realtime-whisper server error${code}: ${message}`))
            break
          }
          default:
            // Ignore session.* lifecycle, etc.
            break
        }
      } catch (err) {
        finish(err instanceof Error ? err : new Error(String(err)))
      }
    })

    ws.addEventListener('error', (event: Event) => {
      const message = (event as { message?: string }).message ?? 'WebSocket transport error'
      finish(new Error(message))
    })

    ws.addEventListener('close', (event: CloseEvent) => {
      if (settled) return
      const reason = event.reason ? `: ${event.reason}` : ''
      finish(new Error(`WebSocket closed before completion (code ${event.code}${reason})`))
    })
  })
}

interface RealtimeServerEvent {
  type: string
  delta?: string
  transcript?: string
  error?: { code?: string; message?: string }
}
