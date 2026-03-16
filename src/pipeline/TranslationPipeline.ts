import { EventEmitter } from 'events'
import type {
  EngineConfig,
  STTEngine,
  TranslatorEngine,
  E2ETranslationEngine,
  TranslationResult,
  Language
} from '../engines/types'

export interface PipelineEvents {
  result: (result: TranslationResult) => void
  error: (error: Error) => void
  'engine-loading': (message: string) => void
  'engine-ready': () => void
}

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

  // Engine factories — registered externally
  private sttFactories = new Map<string, () => STTEngine>()
  private translatorFactories = new Map<string, () => TranslatorEngine>()
  private e2eFactories = new Map<string, () => E2ETranslationEngine>()

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
    if (!this.isRunning || !this.config) return null

    try {
      if (this.config.mode === 'e2e' && this.e2eEngine) {
        const result = await this.e2eEngine.processAudio(audioChunk, sampleRate)
        if (result) {
          this.emit('result', result)
        }
        return result
      }

      if (this.config.mode === 'cascade' && this.sttEngine && this.translator) {
        const sttResult = await this.sttEngine.processAudio(audioChunk, sampleRate)
        if (!sttResult || !sttResult.isFinal || !sttResult.text.trim()) return null

        // Determine translation direction
        const targetLang: Language = sttResult.language === 'ja' ? 'en' : 'ja'
        const translated = await this.translator.translate(
          sttResult.text,
          sttResult.language,
          targetLang
        )

        const result: TranslationResult = {
          sourceText: sttResult.text,
          translatedText: translated,
          sourceLanguage: sttResult.language,
          targetLanguage: targetLang,
          timestamp: Date.now()
        }

        this.emit('result', result)
        return result
      }

      return null
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      return null
    }
  }

  start(): void {
    this.isRunning = true
  }

  stop(): void {
    this.isRunning = false
  }

  get running(): boolean {
    return this.isRunning
  }

  get currentConfig(): EngineConfig | null {
    return this.config
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
