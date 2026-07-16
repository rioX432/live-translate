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

const log = createLogger('gemini-live-e2e')

/**
 * BidiGenerateContent WebSocket endpoint. The API key is NOT part of this
 * constant: Gemini authenticates via a `?key=` query parameter (unlike OpenAI's
 * Authorization header), and the key is appended by the socket factory so it
 * never reaches a log line or a test assertion on the endpoint.
 * https://ai.google.dev/gemini-api/docs/live-api/live-translate
 */
const ENDPOINT =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent'

/** Preview model — see GeminiLiveE2E docstring for why this is never a default. */
const MODEL = 'models/gemini-3.5-live-translate-preview'

/**
 * Live Translate takes raw 16-bit PCM at 16 kHz mono LE, which is exactly what the
 * #721 capture adapter emits — so encodePcm16Base64 resamples nothing on this path.
 */
const INPUT_SAMPLE_RATE = 16000
const INPUT_MIME_TYPE = `audio/pcm;rate=${INPUT_SAMPLE_RATE}`

/** Socket send-buffer high-water mark (bytes) that triggers backpressure. */
const MAX_BUFFERED_BYTES = 1 << 20 // 1 MB
/** Cap on audio chunks queued before the session is ready (~5s at 100ms/chunk). */
const MAX_PENDING_PREOPEN = 50
/** Bounded reconnect policy for unexpected mid-session disconnects. */
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 3
const DEFAULT_RECONNECT_BASE_DELAY_MS = 500
/** Poll interval while awaiting the send buffer to drain. */
const DRAIN_POLL_MS = 20

/**
 * Minimal socket abstraction so the session can be unit-tested without a live
 * WebSocket. Deliberately a separate declaration from CloudRealtimeE2E's rather
 * than a shared one: the two cloud paths are independent (one preview, one M1
 * default) and a common abstraction would have to be designed against exactly two
 * samples, one of which may change under us.
 */
export interface GeminiLiveSocket {
  send(data: string): void
  close(code?: number): void
  readonly bufferedAmount: number
  onOpen(cb: () => void): void
  onMessage(cb: (data: string) => void): void
  onError(cb: (err: Error) => void): void
  onClose(cb: (code: number) => void): void
}

export type GeminiLiveSocketFactory = (url: string, apiKey: string) => GeminiLiveSocket

function defaultSocketFactory(url: string, apiKey: string): GeminiLiveSocket {
  const ws = new WebSocket(`${url}?key=${encodeURIComponent(apiKey)}`)
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

export interface GeminiLiveE2EOptions {
  /** User's Google AI (Gemini) API key with Live API access (BYOK). Required. */
  apiKey: string
  /** Source language of the speaker (used for result labelling only). */
  sourceLanguage?: SourceLanguage
  /**
   * Target output language (BCP-47). Live Translate fixes the output language per
   * session via translationConfig, so bidirectional JA⇄EN auto-switching is not
   * supported in a single session — the session translates everything into this
   * language.
   */
  targetLanguage?: Language
  /** Sample rate of chunks passed to pushAudio (default 16 kHz, from #721 adapter). */
  sourceSampleRate?: number
  /** Injectable socket factory for testing. */
  socketFactory?: GeminiLiveSocketFactory
  /** Status callback surfaced to the renderer (reconnect notices, errors). */
  onStatus?: (msg: string) => void
  maxReconnectAttempts?: number
  reconnectBaseDelayMs?: number
}

/** Shape of the BidiGenerateContent server messages this session consumes. */
interface TranscriptionPayload {
  text?: unknown
}
interface ServerContent {
  inputTranscription?: TranscriptionPayload
  input_transcription?: TranscriptionPayload
  outputTranscription?: TranscriptionPayload
  output_transcription?: TranscriptionPayload
  turnComplete?: unknown
  turn_complete?: unknown
}
interface ServerMessage {
  setupComplete?: unknown
  setup_complete?: unknown
  serverContent?: ServerContent
  server_content?: ServerContent
  goAway?: unknown
  go_away?: unknown
  error?: { message?: string }
}

/**
 * End-to-end cloud realtime speech-translation engine backed by Google's Gemini
 * Live API (gemini-3.5-live-translate-preview, BYOK). Second cloud path alongside
 * CloudRealtimeE2E, provided for shadow-mode comparison and redundancy.
 *
 * The model is Preview: spec and SLA may change without notice, so this is never a
 * production default (M1 prefers gpt-realtime-translate) and is surfaced in the UI
 * as experimental. Cloud, opt-in — never the offline default.
 */
export class GeminiLiveE2E implements E2ETranslationEngine {
  readonly id = 'gemini-live-e2e'
  readonly name = 'Gemini Live (gemini-3.5-live-translate-preview)'
  readonly isOffline = false

  private readonly options: GeminiLiveE2EOptions

  constructor(options: GeminiLiveE2EOptions) {
    if (!options.apiKey) {
      throw new Error('GeminiLiveE2E requires a Gemini API key')
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
    return new GeminiLiveSession(this.options)
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
export class GeminiLiveSession implements E2EStreamingSession {
  private readonly options: GeminiLiveE2EOptions
  private readonly socketFactory: GeminiLiveSocketFactory
  private readonly maxReconnects: number
  private readonly reconnectBaseDelay: number

  private socket: GeminiLiveSocket | null = null
  private sink: E2EStreamingSink | null = null
  private signal: AbortSignal | null = null
  /**
   * BidiGenerateContent requires the `setup` message to be acknowledged by
   * `setupComplete` before content flows, so audio is gated on this rather than on
   * socket open (the OpenAI path has no such handshake).
   */
  private ready = false
  private closedByUs = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  /** Accumulated interim source-language transcript (for the current segment). */
  private inputBuffer = ''
  /** Accumulated interim translated-text delta (for the current segment). */
  private outputBuffer = ''
  /** Base64 audio chunks captured before the setup handshake completed. */
  private pendingAudio: string[] = []

  constructor(options: GeminiLiveE2EOptions) {
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
    const encoded = encodePcm16Base64(chunk, this.options.sourceSampleRate ?? SOURCE_SAMPLE_RATE, INPUT_SAMPLE_RATE)

    if (!this.ready || !this.socket) {
      // Queue a bounded amount of audio until setup completes; drop the oldest
      // beyond the cap so a slow handshake can't grow memory unbounded.
      if (this.pendingAudio.length >= MAX_PENDING_PREOPEN) this.pendingAudio.shift()
      this.pendingAudio.push(encoded)
      return
    }

    this.sendAudio(encoded)

    if (this.socket.bufferedAmount > MAX_BUFFERED_BYTES) {
      return { drained: this.waitForDrain() }
    }
  }

  /**
   * Boundary hint from the capture layer (detected speech pause). Gemini's own
   * automatic activity detection also emits turnComplete, but that boundary is the
   * model's, not the capture layer's — finalizing here keeps the overlay's
   * committed line in step with the local VAD, as the OpenAI path does.
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

    socket.onOpen(() => this.sendSetup())
    socket.onMessage((data) => this.handleMessage(data))
    socket.onError((err) => {
      log.warn('Gemini Live socket error:', err.message)
      this.options.onStatus?.(`Gemini Live error: ${err.message}`)
      terminate()
    })
    socket.onClose(() => terminate())
  }

  private onConnectionTerminated(): void {
    this.ready = false
    if (this.closedByUs || this.signal?.aborted) return

    if (this.reconnectAttempts < this.maxReconnects) {
      this.reconnectAttempts++
      const delay = this.reconnectBaseDelay * this.reconnectAttempts
      this.options.onStatus?.(
        `Gemini Live connection lost — reconnecting (${this.reconnectAttempts}/${this.maxReconnects})...`
      )
      this.reconnectTimer = setTimeout(() => {
        this.reconnectTimer = null
        if (!this.closedByUs && !this.signal?.aborted) this.connect()
      }, delay)
    } else {
      // Reconnect budget exhausted — surface the error and fully tear down so any
      // pending waitForDrain() resolves instead of hanging on a dead socket.
      this.emitError(new Error('Gemini Live translation connection lost'))
      this.teardown()
    }
  }

  private sendSetup(): void {
    // Verbatim schema from the Live Translate guide. responseModalities must be
    // AUDIO — the translate model supports no TEXT modality — so the model also
    // speaks the translation; we consume outputAudioTranscription for subtitles
    // and drop the synthesized audio parts unread (TTS is out of scope).
    // echoTargetLanguage defaults to false, which makes the model stay SILENT when
    // the speaker is already using the target language; for a meeting overlay that
    // would drop those lines entirely, so it is turned on.
    const payload = {
      setup: {
        model: MODEL,
        generationConfig: {
          responseModalities: ['AUDIO'],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          translationConfig: {
            targetLanguageCode: this.options.targetLanguage ?? 'en',
            echoTargetLanguage: true
          }
        }
      }
    }
    this.trySend(JSON.stringify(payload))
  }

  private sendAudio(base64Audio: string): void {
    this.trySend(
      JSON.stringify({ realtimeInput: { audio: { data: base64Audio, mimeType: INPUT_MIME_TYPE } } })
    )
  }

  private trySend(data: string): void {
    try {
      this.socket?.send(data)
    } catch (err) {
      log.warn('Gemini Live send failed:', err instanceof Error ? err.message : String(err))
    }
  }

  private flushPendingAudio(): void {
    if (this.pendingAudio.length === 0) return
    for (const audio of this.pendingAudio) this.sendAudio(audio)
    this.pendingAudio = []
  }

  private handleMessage(data: string): void {
    if (this.signal?.aborted || this.closedByUs) return

    let event: ServerMessage
    try {
      event = JSON.parse(data) as ServerMessage
    } catch {
      return
    }

    // The endpoint is Preview and its JSON mapping may surface either the proto
    // field names or their lowerCamelCase form, so both spellings are accepted
    // rather than betting the subtitle path on one of them.
    if (event.setupComplete ?? event.setup_complete) {
      this.ready = true
      this.reconnectAttempts = 0
      this.flushPendingAudio()
      return
    }

    if (event.goAway ?? event.go_away) {
      // Server is about to disconnect; the ensuing close drives the reconnect path.
      log.info('Gemini Live server sent goAway — expecting reconnect')
      this.options.onStatus?.('Gemini Live session ending — reconnecting...')
      return
    }

    if (event.error) {
      this.emitError(new Error(event.error.message ?? 'Gemini Live translation error'))
      return
    }

    const content = event.serverContent ?? event.server_content
    if (!content) return

    const inputText = (content.inputTranscription ?? content.input_transcription)?.text
    if (typeof inputText === 'string') this.inputBuffer += inputText

    const outputText = (content.outputTranscription ?? content.output_transcription)?.text
    if (typeof outputText === 'string' && outputText) {
      this.outputBuffer += outputText
      this.emitInterim(this.outputBuffer)
    }

    if (content.turnComplete ?? content.turn_complete) {
      this.emitFinal(this.outputBuffer)
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
        if (
          this.signal?.aborted ||
          this.closedByUs ||
          !this.socket ||
          this.socket.bufferedAmount <= MAX_BUFFERED_BYTES
        ) {
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
    this.ready = false
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
