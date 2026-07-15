import WebSocket from 'ws'
import type {
  Backpressure,
  E2EStreamingSession,
  E2EStreamingSink,
  E2EStreamingStartOptions,
  E2EStreamingStopOptions,
  E2ETranslationEngine,
  Language,
  SourceLanguage,
  TranslationResult
} from '../types'
import { encodePcm16Base64, SOURCE_SAMPLE_RATE } from './audioEncoding'
import { createLogger } from '../../main/logger'

const log = createLogger('cloud-realtime-e2e')

/** WebSocket endpoint for gpt-realtime-translate (base64 LE PCM16 @ 24kHz). */
const ENDPOINT = 'wss://api.openai.com/v1/realtime/translations?model=gpt-realtime-translate'

/** Socket send-buffer high-water mark (bytes) that triggers backpressure. */
const MAX_BUFFERED_BYTES = 1 << 20 // 1 MB
/** Cap on audio chunks queued before the socket opens (~5s at 100ms/chunk). */
const MAX_PENDING_PREOPEN = 50
/** Bounded reconnect policy for unexpected mid-session disconnects. */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3
const DEFAULT_RECONNECT_BASE_DELAY_MS = 500
/** Poll interval while awaiting the send buffer to drain. */
const DRAIN_POLL_MS = 20

/**
 * Minimal socket abstraction so the session can be unit-tested without a live
 * WebSocket. The default factory wraps the `ws` client used at runtime.
 */
export interface RealtimeSocket {
  send(data: string): void
  close(code?: number): void
  readonly bufferedAmount: number
  onOpen(cb: () => void): void
  onMessage(cb: (data: string) => void): void
  onError(cb: (err: Error) => void): void
  onClose(cb: (code: number) => void): void
}

export type RealtimeSocketFactory = (url: string, apiKey: string) => RealtimeSocket

function defaultSocketFactory(url: string, apiKey: string): RealtimeSocket {
  const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  return {
    send: (data) => ws.send(data),
    close: (code) => ws.close(code),
    get bufferedAmount(): number {
      return ws.bufferedAmount
    },
    onOpen: (cb) => ws.on('open', cb),
    onMessage: (cb) => ws.on('message', (data: WebSocket.RawData) => cb(data.toString())),
    onError: (cb) => ws.on('error', cb),
    onClose: (cb) => ws.on('close', (code: number) => cb(code))
  }
}

export interface CloudRealtimeE2EOptions {
  /** User's OpenAI API key (BYOK). Required. */
  apiKey: string
  /** Source language of the speaker (used for result labelling only). */
  sourceLanguage?: SourceLanguage
  /**
   * Target output language. gpt-realtime-translate fixes the output language per
   * session, so bidirectional JA⇄EN auto-switching is not supported in a single
   * session — the session translates everything into this language.
   */
  targetLanguage?: Language
  /** Sample rate of chunks passed to pushAudio (default 16 kHz, from #721 adapter). */
  sourceSampleRate?: number
  /** Injectable socket factory for testing. */
  socketFactory?: RealtimeSocketFactory
  /** Status callback surfaced to the renderer (reconnect notices, errors). */
  onStatus?: (msg: string) => void
  maxReconnectAttempts?: number
  reconnectBaseDelayMs?: number
}

/**
 * End-to-end cloud realtime speech-translation engine backed by OpenAI's
 * gpt-realtime-translate WebSocket API (BYOK). Streams source audio and emits
 * interim/final translated subtitles. Cloud, opt-in — never the offline default.
 */
export class CloudRealtimeE2E implements E2ETranslationEngine {
  readonly id = 'cloud-realtime-e2e'
  readonly name = 'Cloud Realtime (gpt-realtime-translate)'
  readonly isOffline = false

  private readonly options: CloudRealtimeE2EOptions

  constructor(options: CloudRealtimeE2EOptions) {
    if (!options.apiKey) {
      throw new Error('CloudRealtimeE2E requires an OpenAI API key')
    }
    this.options = options
  }

  async initialize(): Promise<void> {
    // No local model to load; the key was validated in the constructor.
    // A live handshake is deferred to session start to avoid holding a socket open while idle.
  }

  /** Single-shot batch translation is not supported — this engine is streaming-only. */
  async processAudio(_audioChunk: Float32Array, _sampleRate: number): Promise<TranslationResult | null> {
    return null
  }

  createStreamingSession(): E2EStreamingSession {
    return new CloudRealtimeSession(this.options)
  }

  async dispose(): Promise<void> {
    // Sessions own their sockets and are torn down via stop()/abort.
  }
}

/**
 * A single live translation session. Lifecycle:
 * start() → pushAudio()* [→ flushSegment()]* → stop().
 * Honors the AbortSignal from start(): once aborted, no further sink emissions.
 */
export class CloudRealtimeSession implements E2EStreamingSession {
  private readonly options: CloudRealtimeE2EOptions
  private readonly socketFactory: RealtimeSocketFactory
  private readonly maxReconnects: number
  private readonly reconnectBaseDelay: number

  private socket: RealtimeSocket | null = null
  private sink: E2EStreamingSink | null = null
  private signal: AbortSignal | null = null
  private opened = false
  private closedByUs = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  /** Accumulated interim source-language transcript (for the current segment). */
  private inputBuffer = ''
  /** Accumulated interim translated-text delta (for the current segment). */
  private outputBuffer = ''
  /** Base64 audio chunks captured before the socket finished opening. */
  private pendingAudio: string[] = []

  constructor(options: CloudRealtimeE2EOptions) {
    this.options = options
    this.socketFactory = options.socketFactory ?? defaultSocketFactory
    this.maxReconnects = options.maxReconnectAttempts ?? DEFAULT_MAX_RECONNECT_ATTEMPTS
    this.reconnectBaseDelay = options.reconnectBaseDelayMs ?? DEFAULT_RECONNECT_BASE_DELAY_MS
  }

  async start(options: E2EStreamingStartOptions): Promise<void> {
    this.sink = options.sink
    this.signal = options.signal
    this.closedByUs = false
    this.signal.addEventListener('abort', () => this.teardown(), { once: true })
    this.connect()
  }

  async pushAudio(chunk: Float32Array): Promise<void | Backpressure> {
    if (this.signal?.aborted || this.closedByUs || chunk.length === 0) return
    const encoded = encodePcm16Base64(chunk, this.options.sourceSampleRate ?? SOURCE_SAMPLE_RATE)

    if (!this.opened || !this.socket) {
      // Queue a bounded amount of audio until the socket opens; drop the oldest
      // beyond the cap so a slow handshake can't grow memory unbounded.
      if (this.pendingAudio.length >= MAX_PENDING_PREOPEN) this.pendingAudio.shift()
      this.pendingAudio.push(encoded)
      return
    }

    this.sendAppend(encoded)

    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      return { drained: this.waitForDrain() }
    }
  }

  /**
   * Boundary hint from the capture layer (detected speech pause). The translation
   * endpoint has no explicit turn commit, so we finalize the accumulated interim
   * translation here to give the overlay a stable committed line.
   */
  async flushSegment(): Promise<void> {
    if (this.signal?.aborted || this.closedByUs) return
    if (this.outputBuffer) this.emitFinal(this.outputBuffer)
  }

  async stop(options?: E2EStreamingStopOptions): Promise<void> {
    // A flush only surfaces while the session is still live: emitFinal (and the
    // pipeline's sink adapter) both gate on the abort signal, so a stop({flush})
    // issued after abort intentionally drops the trailing line rather than
    // emitting stale output across a generation switch.
    if (options?.flush && this.outputBuffer) this.emitFinal(this.outputBuffer)
    this.teardown()
  }

  // --- internals ---

  private connect(): void {
    // Close any prior (dead) socket before replacing it, mirroring teardown().
    try {
      this.socket?.close()
    } catch {
      // ignore
    }
    const socket = this.socketFactory(ENDPOINT, this.options.apiKey)
    this.socket = socket

    // Guard so a socket that fires both 'error' and 'close' only triggers one
    // reconnect decision for this connection attempt.
    let terminated = false
    const terminate = (): void => {
      if (terminated) return
      terminated = true
      this.onConnectionTerminated()
    }

    socket.onOpen(() => {
      this.opened = true
      this.reconnectAttempts = 0
      this.sendSessionUpdate()
      this.flushPendingAudio()
    })
    socket.onMessage((data) => this.handleMessage(data))
    socket.onError((err) => {
      log.warn('Realtime socket error:', err.message)
      this.options.onStatus?.(`Realtime error: ${err.message}`)
      terminate()
    })
    socket.onClose(() => terminate())
  }

  private onConnectionTerminated(): void {
    this.opened = false
    if (this.closedByUs || this.signal?.aborted) return

    if (this.reconnectAttempts < this.maxReconnects) {
      this.reconnectAttempts++
      const delay = this.reconnectBaseDelay * this.reconnectAttempts
      this.options.onStatus?.(`Realtime connection lost — reconnecting (${this.reconnectAttempts}/${this.maxReconnects})...`)
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        if (!this.closedByUs && !this.signal?.aborted) this.connect()
      }, delay)
    } else {
      // Reconnect budget exhausted — surface the error and fully tear down so any
      // pending waitForDrain() resolves instead of hanging on a dead socket.
      this.emitError(new Error('Realtime translation connection lost'))
      this.teardown()
    }
  }

  private sendSessionUpdate(): void {
    // Verbatim schema from the gpt-realtime-translate guide: the output language
    // is set via session.audio.output.language; input transcription uses the
    // realtime whisper model. Passed as ISO 639-1 code (e.g. 'en', 'ja').
    const payload = {
      type: 'session.update',
      session: {
        audio: {
          input: {
            transcription: { model: 'gpt-realtime-whisper' },
            noise_reduction: { type: 'near_field' }
          },
          output: { language: this.options.targetLanguage ?? 'en' }
        }
      }
    }
    this.trySend(JSON.stringify(payload))
  }

  private sendAppend(base64Audio: string): void {
    this.trySend(JSON.stringify({ type: 'session.input_audio_buffer.append', audio: base64Audio }))
  }

  private trySend(data: string): void {
    try {
      this.socket?.send(data)
    } catch (err) {
      log.warn('Realtime send failed:', err instanceof Error ? err.message : String(err))
    }
  }

  private flushPendingAudio(): void {
    if (this.pendingAudio.length === 0) return
    for (const audio of this.pendingAudio) this.sendAppend(audio)
    this.pendingAudio = []
  }

  private handleMessage(data: string): void {
    if (this.signal?.aborted || this.closedByUs) return

    let event: { type?: string; delta?: unknown; transcript?: unknown; error?: { message?: string } }
    try {
      event = JSON.parse(data)
    } catch {
      return
    }

    switch (event.type) {
      case 'session.input_transcript.delta':
        if (typeof event.delta === 'string') this.inputBuffer += event.delta
        break
      case 'session.output_transcript.delta':
        if (typeof event.delta === 'string') {
          this.outputBuffer += event.delta
          this.emitInterim(this.outputBuffer)
        }
        break
      // The guide documents no explicit "done" event; handle both plausible names
      // defensively so a final line commits promptly if the endpoint emits one.
      case 'session.output_transcript.done':
      case 'session.output_transcript.completed':
        this.emitFinal(typeof event.transcript === 'string' ? event.transcript : this.outputBuffer)
        break
      case 'error':
      case 'session.error':
        this.emitError(new Error(event.error?.message ?? 'Realtime translation error'))
        break
      default:
        break
    }
  }

  private buildResult(translatedText: string, isInterim: boolean): TranslationResult {
    const targetLanguage = this.options.targetLanguage ?? 'en'
    const sourceLanguage =
      this.options.sourceLanguage && this.options.sourceLanguage !== 'auto'
        ? this.options.sourceLanguage
        : targetLanguage === 'en'
          ? 'ja'
          : 'en'
    return {
      sourceText: this.inputBuffer,
      translatedText,
      sourceLanguage,
      targetLanguage,
      timestamp: Date.now(),
      isInterim
    }
  }

  private emitInterim(text: string): void {
    if (this.signal?.aborted || !text) return
    this.sink?.interim(this.buildResult(text, true))
  }

  private emitFinal(text: string): void {
    if (this.signal?.aborted || !text) return
    this.sink?.final(this.buildResult(text, false))
    // Reset per-segment accumulators for the next utterance.
    this.outputBuffer = ''
    this.inputBuffer = ''
  }

  private emitError(err: Error): void {
    if (this.signal?.aborted) return
    this.sink?.error(err)
  }

  private waitForDrain(): Promise<void> {
    return new Promise((resolve) => {
      const check = (): void => {
        if (this.signal?.aborted || this.closedByUs || !this.socket || this.socket.bufferedAmount <= MAX_BUFFERED_BYTES) {
          resolve()
          return
        }
        setTimeout(check, DRAIN_POLL_MS)
      }
      check()
    })
  }

  private teardown(): void {
    this.closedByUs = true
    this.opened = false
    this.pendingAudio = []
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    try {
      this.socket?.close()
    } catch {
      // ignore close errors during teardown
    }
    this.socket = null
  }
}
