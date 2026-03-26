/**
 * WebSocket server for receiving tab audio from the Chrome extension.
 *
 * Listens on a configurable port (default 9876) and accepts binary
 * Float32 PCM audio data at 16kHz mono from the extension's offscreen
 * document. Audio chunks are forwarded to the translation pipeline
 * via a callback.
 *
 * Protocol:
 * - Client sends JSON: { type: 'hello', source: 'chrome-extension' }
 * - Client sends JSON: { type: 'ping' } → Server responds { type: 'pong' }
 * - Client sends binary ArrayBuffer of Float32 PCM audio samples
 * - Server may send JSON: { type: 'status', message: string }
 */

import { createServer, type Server, type IncomingMessage } from 'http'
import { WebSocketServer, WebSocket } from 'ws'
import { EventEmitter } from 'events'
import { createLogger } from './logger'
import { DEFAULT_WS_PORT } from './constants'

const log = createLogger('ws-audio')

export interface WsAudioServerEvents {
  /** Emitted when a valid audio chunk is received */
  audio: (chunk: Float32Array) => void
  /** Emitted when a Chrome extension client connects */
  connected: () => void
  /** Emitted when the Chrome extension client disconnects */
  disconnected: () => void
  /** Emitted on server errors */
  error: (error: Error) => void
}

const SAMPLE_RATE = 16000
const MIN_SAMPLES = 8000 // 0.5s minimum

export class WsAudioServer extends EventEmitter {
  private httpServer: Server | null = null
  private wss: WebSocketServer | null = null
  private client: WebSocket | null = null
  private _port: number
  private _running = false

  constructor(port = DEFAULT_WS_PORT) {
    super()
    this._port = port
  }

  get port(): number {
    return this._port
  }

  get running(): boolean {
    return this._running
  }

  get hasClient(): boolean {
    return this.client !== null && this.client.readyState === WebSocket.OPEN
  }

  /**
   * Start the WebSocket server.
   * Binds to 127.0.0.1 only (localhost) for security.
   */
  async start(): Promise<void> {
    if (this._running) return

    return new Promise((resolve, reject) => {
      this.httpServer = createServer()
      this.wss = new WebSocketServer({ server: this.httpServer })

      this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
        // Only allow connections from localhost
        const remoteAddr = req.socket.remoteAddress
        if (remoteAddr !== '127.0.0.1' && remoteAddr !== '::1' && remoteAddr !== '::ffff:127.0.0.1') {
          log.warn(`Rejected connection from non-localhost: ${remoteAddr}`)
          ws.close(1008, 'Only localhost connections allowed')
          return
        }

        // Only allow one client at a time
        if (this.client && this.client.readyState === WebSocket.OPEN) {
          log.warn('Rejecting second client — only one extension connection allowed')
          ws.close(1013, 'Only one client allowed')
          return
        }

        log.info('Chrome extension connected')
        this.client = ws
        this.emit('connected')

        ws.on('message', (data: Buffer | ArrayBuffer | Buffer[], isBinary: boolean) => {
          if (isBinary) {
            this.handleAudioData(data as Buffer)
          } else {
            this.handleTextMessage(ws, data.toString())
          }
        })

        ws.on('close', () => {
          log.info('Chrome extension disconnected')
          if (this.client === ws) {
            this.client = null
          }
          this.emit('disconnected')
        })

        ws.on('error', (err) => {
          log.error('Client error:', err)
          this.emit('error', err)
        })
      })

      this.wss.on('error', (err) => {
        log.error('Server error:', err)
        this.emit('error', err)
      })

      this.httpServer.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          reject(new Error(`Port ${this._port} is already in use. Choose a different WebSocket port.`))
        } else {
          reject(err)
        }
      })

      this.httpServer.listen(this._port, '127.0.0.1', () => {
        this._running = true
        log.info(`Server listening on ws://127.0.0.1:${this._port}`)
        resolve()
      })
    })
  }

  /**
   * Stop the WebSocket server and disconnect all clients.
   */
  async stop(): Promise<void> {
    if (!this._running) return

    this._running = false

    // Close client connection
    if (this.client) {
      this.client.close(1000, 'Server shutting down')
      this.client = null
    }

    // Close WebSocket server
    if (this.wss) {
      this.wss.close()
      this.wss = null
    }

    // Close HTTP server
    return new Promise((resolve) => {
      if (this.httpServer) {
        this.httpServer.close(() => {
          this.httpServer = null
          log.info('Server stopped')
          resolve()
        })
      } else {
        resolve()
      }
    })
  }

  /**
   * Send a status message to the connected client.
   */
  sendStatus(message: string): void {
    if (this.client && this.client.readyState === WebSocket.OPEN) {
      this.client.send(JSON.stringify({ type: 'status', message }))
    }
  }

  /**
   * Handle binary audio data from the extension.
   */
  private handleAudioData(data: Buffer): void {
    // Convert Buffer to Float32Array
    const float32 = new Float32Array(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    )

    // Validate minimum sample count
    if (float32.length < MIN_SAMPLES) {
      return
    }

    // Validate data isn't corrupted (check for NaN/Infinity)
    let hasInvalid = false
    for (let i = 0; i < Math.min(float32.length, 100); i++) {
      if (!isFinite(float32[i])) {
        hasInvalid = true
        break
      }
    }
    if (hasInvalid) {
      log.warn('Received audio data with invalid samples, discarding')
      return
    }

    this.emit('audio', float32)
  }

  /**
   * Handle JSON text messages from the extension.
   */
  private handleTextMessage(ws: WebSocket, text: string): void {
    try {
      const msg = JSON.parse(text)

      switch (msg.type) {
        case 'hello':
          log.info(`Client identified: ${msg.source}`)
          ws.send(JSON.stringify({ type: 'welcome', sampleRate: SAMPLE_RATE }))
          break

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }))
          break

        default:
          log.warn(`Unknown message type: ${msg.type}`)
      }
    } catch {
      log.warn('Failed to parse text message')
    }
  }
}
