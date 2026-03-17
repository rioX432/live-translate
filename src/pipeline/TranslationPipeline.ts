import { EventEmitter } from 'events'
import type {
  EngineConfig,
  STTEngine,
  TranslatorEngine,
  E2ETranslationEngine,
  TranslationResult,
  Language
} from '../engines/types'
import { LocalAgreement } from './LocalAgreement'

export interface PipelineEvents {
  result: (result: TranslationResult) => void
  'interim-result': (result: TranslationResult) => void
  error: (error: Error) => void
  'engine-loading': (message: string) => void
  'engine-ready': () => void
}

const MAX_CONSECUTIVE_ERRORS = 3
const RECOVERY_DELAY_MS = 1000

/**
 * Manages the STT → Translation pipeline.
 * Supports two modes:
 * - cascade: STTEngine + TranslatorEngine (online mode)
 * - e2e: E2ETranslationEngine (offline mode)
 *
 * Engines are swappable at runtime via switchEngine().
 */
export class TranslationPipeline extends EventEmitter {
  private config: EngineConfig | null = null
  private sttEngine: STTEngine | null = null
  private translator: TranslatorEngine | null = null
  private e2eEngine: E2ETranslationEngine | null = null
  private isRunning = false
  private agreement = new LocalAgreement()
  private lastTranslatedConfirmed = ''
  private streamingLock = false

  // Engine factories — registered externally
  private sttFactories = new Map<string, () => STTEngine>()
  private translatorFactories = new Map<string, () => TranslatorEngine>()
  private e2eFactories = new Map<string, () => E2ETranslationEngine>()

  // Auto-recovery state
  private consecutiveErrors = 0
  private recovering = false

  // Memory monitoring
  private memoryTimer: ReturnType<typeof setInterval> | null = null
  private startedAt: number | null = null

  /** Register an STT engine factory */
  registerSTT(id: string, factory: () => STTEngine): void {
    this.sttFactories.set(id, factory)
  }

  /** Register a translator engine factory */
  registerTranslator(id: string, factory: () => TranslatorEngine): void {
    this.translatorFactories.set(id, factory)
  }

  /** Register an E2E engine factory */
  registerE2E(id: string, factory: () => E2ETranslationEngine): void {
    this.e2eFactories.set(id, factory)
  }

  /** Switch to a new engine configuration. Disposes previous engines. */
  async switchEngine(config: EngineConfig): Promise<void> {
    // Dispose existing engines
    await this.disposeEngines()

    this.config = config

    try {
      if (config.mode === 'cascade') {
        const sttId = config.sttEngineId
        const translatorId = config.translatorEngineId
        if (!sttId || !translatorId) {
          throw new Error('cascade mode requires sttEngineId and translatorEngineId')
        }

        const sttFactory = this.sttFactories.get(sttId)
        const translatorFactory = this.translatorFactories.get(translatorId)
        if (!sttFactory) throw new Error(`STT engine not found: ${sttId}`)
        if (!translatorFactory) throw new Error(`Translator engine not found: ${translatorId}`)

        this.emit('engine-loading', 'Loading STT model...')
        this.sttEngine = sttFactory()
        await this.sttEngine.initialize()

        this.emit('engine-loading', 'Initializing translator...')
        this.translator = translatorFactory()
        await this.translator.initialize()
      } else if (config.mode === 'e2e') {
        const e2eId = config.e2eEngineId
        if (!e2eId) throw new Error('e2e mode requires e2eEngineId')

        const e2eFactory = this.e2eFactories.get(e2eId)
        if (!e2eFactory) throw new Error(`E2E engine not found: ${e2eId}`)

        this.emit('engine-loading', 'Loading translation model...')
        this.e2eEngine = e2eFactory()
        await this.e2eEngine.initialize()
      }

      this.emit('engine-ready')
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  /** Process an audio chunk through the current pipeline */
  async process(audioChunk: Float32Array, sampleRate: number): Promise<TranslationResult | null> {
    if (!this.isRunning || !this.config || this.recovering) return null

    try {
      let result: TranslationResult | null = null

      if (this.config.mode === 'e2e' && this.e2eEngine) {
        result = await this.e2eEngine.processAudio(audioChunk, sampleRate)
      } else if (this.config.mode === 'cascade' && this.sttEngine) {
        result = await this.processCascade(audioChunk, sampleRate)
      }

      if (result) {
        this.consecutiveErrors = 0
        this.emit('result', result)
      }
      return result
    } catch (err) {
      this.consecutiveErrors++
      const error = err instanceof Error ? err : new Error(String(err))
      this.emit('error', error)

      if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        await this.attemptRecovery()
      }

      return null
    }
  }

  private async processCascade(
    audioChunk: Float32Array,
    sampleRate: number
  ): Promise<TranslationResult | null> {
    if (!this.sttEngine) return null

    const sttResult = await this.sttEngine.processAudio(audioChunk, sampleRate)
    if (!sttResult || !sttResult.isFinal || !sttResult.text.trim()) return null

    const targetLang: Language = sttResult.language === 'ja' ? 'en' : 'ja'

    // Graceful degradation: if translator fails, emit STT-only result
    if (this.translator) {
      try {
        const translated = await this.translator.translate(
          sttResult.text,
          sttResult.language,
          targetLang
        )

        return {
          sourceText: sttResult.text,
          translatedText: translated,
          sourceLanguage: sttResult.language,
          targetLanguage: targetLang,
          timestamp: Date.now()
        }
      } catch (translatorErr) {
        console.error('[pipeline] Translator error, falling back to STT-only:', translatorErr)
        this.emit('error', new Error(`Translation unavailable: ${translatorErr}`))

        // Return STT-only result so the user at least sees transcription
        return {
          sourceText: sttResult.text,
          translatedText: '(translation unavailable)',
          sourceLanguage: sttResult.language,
          targetLanguage: targetLang,
          timestamp: Date.now()
        }
      }
    }

    return null
  }

  private async attemptRecovery(): Promise<void> {
    if (this.recovering || !this.config) return
    this.recovering = true

    console.log('[pipeline] Attempting auto-recovery after consecutive errors...')
    this.emit('engine-loading', 'Recovering from errors...')

    try {
      await new Promise((resolve) => setTimeout(resolve, RECOVERY_DELAY_MS))
      await this.switchEngine(this.config)
      this.consecutiveErrors = 0
      console.log('[pipeline] Auto-recovery successful')
      this.emit('engine-ready')
    } catch (err) {
      console.error('[pipeline] Auto-recovery failed:', err)
      this.emit('error', new Error('Auto-recovery failed. Please restart manually.'))
    } finally {
      this.recovering = false
    }
  }

  /**
   * Process a rolling audio buffer for streaming (Local Agreement).
   * Emits interim-result with confirmed + interim text.
   * Only translates newly confirmed text.
   */
  async processStreaming(audioBuffer: Float32Array, sampleRate: number): Promise<TranslationResult | null> {
    if (!this.isRunning || !this.config) return null
    if (this.config.mode !== 'cascade' || !this.sttEngine) return null
    if (this.streamingLock) return null

    this.streamingLock = true
    try {
      const sttResult = await this.sttEngine.processAudio(audioBuffer, sampleRate)
      if (!sttResult || !sttResult.text.trim()) return null

      const agreement = this.agreement.update(sttResult.text)

      const targetLang: Language = sttResult.language === 'ja' ? 'en' : 'ja'

      // Translate only newly confirmed text
      let translatedText = ''
      if (agreement.newConfirmed && this.translator) {
        // Translate the full confirmed text for better context
        translatedText = await this.translator.translate(
          agreement.confirmedText,
          sttResult.language,
          targetLang
        )
        this.lastTranslatedConfirmed = translatedText
      } else {
        translatedText = this.lastTranslatedConfirmed
      }

      // Emit interim result (confirmed + interim text for display)
      const interimResult: TranslationResult = {
        sourceText: agreement.confirmedText + agreement.interimText,
        translatedText,
        sourceLanguage: sttResult.language,
        targetLanguage: targetLang,
        timestamp: Date.now(),
        isInterim: true
      }

      this.emit('interim-result', interimResult)
      return interimResult
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      return null
    } finally {
      this.streamingLock = false
    }
  }

  /**
   * Finalize streaming for the current speech segment.
   * Promotes all text to confirmed, translates, and emits a final result.
   */
  async finalizeStreaming(audioChunk: Float32Array, sampleRate: number): Promise<TranslationResult | null> {
    if (!this.isRunning || !this.config) return null
    if (this.config.mode !== 'cascade' || !this.sttEngine) return null

    // Wait for any in-flight streaming operation to complete
    while (this.streamingLock) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
    this.streamingLock = true

    try {
      const sttResult = await this.sttEngine.processAudio(audioChunk, sampleRate)
      if (!sttResult || !sttResult.text.trim()) {
        this.agreement.reset()
        this.lastTranslatedConfirmed = ''
        return null
      }

      const agreement = this.agreement.finalize(sttResult.text)
      const targetLang: Language = sttResult.language === 'ja' ? 'en' : 'ja'

      let translatedText = ''
      if (this.translator && agreement.confirmedText.trim()) {
        translatedText = await this.translator.translate(
          agreement.confirmedText,
          sttResult.language,
          targetLang
        )
      }

      this.lastTranslatedConfirmed = ''

      const result: TranslationResult = {
        sourceText: agreement.confirmedText,
        translatedText,
        sourceLanguage: sttResult.language,
        targetLanguage: targetLang,
        timestamp: Date.now(),
        isInterim: false
      }

      this.emit('result', result)
      return result
    } catch (err) {
      this.agreement.reset()
      this.lastTranslatedConfirmed = ''
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      return null
    } finally {
      this.streamingLock = false
    }
  }

  start(): void {
    this.isRunning = true
    this.startedAt = Date.now()
    this.consecutiveErrors = 0
    this.startMemoryMonitor()
  }

  stop(): void {
    this.isRunning = false
    this.startedAt = null
    this.stopMemoryMonitor()
    this.agreement.reset()
    this.lastTranslatedConfirmed = ''
  }

  get running(): boolean {
    return this.isRunning
  }

  get currentConfig(): EngineConfig | null {
    return this.config
  }

  get sessionStartTime(): number | null {
    return this.startedAt
  }

  private startMemoryMonitor(): void {
    this.stopMemoryMonitor()
    this.logMemoryUsage()
    this.memoryTimer = setInterval(() => this.logMemoryUsage(), 60_000)
    if (typeof this.memoryTimer === 'object' && 'unref' in this.memoryTimer) {
      this.memoryTimer.unref()
    }
  }

  private stopMemoryMonitor(): void {
    if (this.memoryTimer) {
      clearInterval(this.memoryTimer)
      this.memoryTimer = null
    }
  }

  private logMemoryUsage(): void {
    const mem = process.memoryUsage()
    const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1)
    const elapsed = this.startedAt
      ? `${((Date.now() - this.startedAt) / 60_000).toFixed(1)}min`
      : '0min'
    console.log(
      `[memory] elapsed=${elapsed} heap=${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB rss=${mb(mem.rss)}MB external=${mb(mem.external)}MB`
    )
  }

  private async disposeEngines(): Promise<void> {
    await this.sttEngine?.dispose().catch(() => {})
    await this.translator?.dispose().catch(() => {})
    await this.e2eEngine?.dispose().catch(() => {})
    this.sttEngine = null
    this.translator = null
    this.e2eEngine = null
  }

  async dispose(): Promise<void> {
    this.stop()
    await this.disposeEngines()
  }
}
