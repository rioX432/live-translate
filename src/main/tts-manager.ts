import type { BrowserWindow } from 'electron'
import type { TranslationResult } from '../engines/types'
import { KokoroTTSEngine } from '../engines/tts/KokoroTTSEngine'
import { createLogger } from './logger'

const log = createLogger('tts-manager')

/**
 * Manages TTS lifecycle and queuing.
 *
 * Listens for translation results and synthesizes speech,
 * sending PCM audio to the renderer for playback.
 * Uses an interrupt strategy: new text cancels pending synthesis.
 */
export class TTSManager {
  private engine: KokoroTTSEngine | null = null
  private enabled = false
  private currentVoice: string | null = null
  private volume = 1.0

  // Interrupt: track the latest request to cancel stale ones
  private requestId = 0

  /** Initialize the TTS engine (lazy — only when enabled) */
  async initialize(): Promise<void> {
    if (this.engine) return

    this.engine = new KokoroTTSEngine({
      onProgress: (msg) => log.info(msg)
    })

    try {
      await this.engine.initialize()
    } catch (err) {
      log.error('TTS initialization failed:', err)
      this.engine = null
      throw err
    }
  }

  /** Enable or disable TTS */
  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled
    if (enabled && !this.engine) {
      await this.initialize()
    }
    log.info(`TTS ${enabled ? 'enabled' : 'disabled'}`)
  }

  /** Check if TTS is currently enabled */
  isEnabled(): boolean {
    return this.enabled
  }

  /** Set the voice to use */
  setVoice(voiceId: string): void {
    this.currentVoice = voiceId
    this.engine?.setVoice(voiceId)
  }

  /** Set playback volume (0.0-1.0) */
  setVolume(volume: number): void {
    this.volume = Math.max(0, Math.min(1, volume))
  }

  /** Get current volume */
  getVolume(): number {
    return this.volume
  }

  /**
   * Handle a translation result — synthesize and send audio to renderer.
   * Uses interrupt strategy: if a new request arrives while synthesizing,
   * the old result is discarded.
   */
  async handleTranslationResult(
    result: TranslationResult,
    mainWindow: BrowserWindow | null
  ): Promise<void> {
    if (!this.enabled || !this.engine) return

    // Skip interim/draft results — only speak final translations
    if (result.isInterim) return

    const text = result.translatedText
    if (!text?.trim()) return

    // Interrupt: bump request ID so stale synthesis is discarded
    const thisRequest = ++this.requestId

    try {
      const ttsResult = await this.engine.synthesize(text, result.targetLanguage)

      // Check if this request was superseded
      if (thisRequest !== this.requestId) {
        log.info('TTS result discarded (superseded)')
        return
      }

      if (ttsResult.audio.length === 0) return

      // Send audio to renderer for playback via Web Audio API
      // Must convert Float32Array to plain array for IPC transfer
      mainWindow?.webContents.send('tts-audio', {
        audio: Array.from(ttsResult.audio),
        sampleRate: ttsResult.sampleRate,
        volume: this.volume
      })
    } catch (err) {
      log.error('TTS synthesis error:', err)
    }
  }

  /** Dispose the TTS engine and release resources */
  async dispose(): Promise<void> {
    this.requestId++
    if (this.engine) {
      await this.engine.dispose()
      this.engine = null
    }
    log.info('TTSManager disposed')
  }
}
