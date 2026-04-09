import type {
  EngineConfig,
  STTEngine,
  TranslatorEngine,
  E2ETranslationEngine,
  SpeakerDiarizer
} from '../engines/types'
import { HybridTranslator } from '../engines/translator/HybridTranslator'
import type { EventEmitter } from 'events'
import { createLogger } from '../main/logger'

const log = createLogger('pipeline')

const ENGINE_INIT_TIMEOUT_MS = 5 * 60_000 // 5 minutes for model download

/**
 * Manages engine registration, creation, initialization, and disposal.
 * Extracted from TranslationPipeline to separate engine lifecycle from pipeline orchestration.
 */
export class EngineManager {
  private sttFactories = new Map<string, () => STTEngine>()
  private translatorFactories = new Map<string, () => TranslatorEngine>()
  private e2eFactories = new Map<string, () => E2ETranslationEngine>()
  private diarizerFactories = new Map<string, () => SpeakerDiarizer>()

  sttEngine: STTEngine | null = null
  translator: TranslatorEngine | null = null
  e2eEngine: E2ETranslationEngine | null = null
  draftSttEngine: STTEngine | null = null
  /** Secondary quality translator for adaptive routing (#547) */
  qualityTranslator: TranslatorEngine | null = null
  /** Speaker diarizer for multi-speaker identification (#549) */
  diarizer: SpeakerDiarizer | null = null
  config: EngineConfig | null = null

  registerSTT(id: string, factory: () => STTEngine): void {
    this.sttFactories.set(id, factory)
  }

  registerTranslator(id: string, factory: () => TranslatorEngine): void {
    this.translatorFactories.set(id, factory)
  }

  registerE2E(id: string, factory: () => E2ETranslationEngine): void {
    this.e2eFactories.set(id, factory)
  }

  registerDiarizer(id: string, factory: () => SpeakerDiarizer): void {
    this.diarizerFactories.set(id, factory)
  }

  /**
   * Initialize engines for the given configuration.
   * Emits 'engine-loading' status updates via the provided emitter.
   */
  async initializeEngines(config: EngineConfig, emitter: EventEmitter): Promise<void> {
    this.config = config

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

      try {
        emitter.emit('engine-loading', 'Loading STT model...')
        this.sttEngine = await Promise.resolve(sttFactory())
        await this.withTimeout(this.sttEngine.initialize(), ENGINE_INIT_TIMEOUT_MS, 'STT initialization')

        emitter.emit('engine-loading', 'Initializing translator...')
        this.translator = await Promise.resolve(translatorFactory())
        await this.withTimeout(this.translator.initialize(), ENGINE_INIT_TIMEOUT_MS, 'Translator initialization')

        // Wire up draft callback for hybrid translator (#235)
        if (this.translator instanceof HybridTranslator) {
          this.translator.setOnDraft((draft) => {
            emitter.emit('draft-result', draft)
          })
        }
      } catch (err) {
        await this.disposeEngines()
        throw err
      }
    } else if (config.mode === 'e2e') {
      const e2eId = config.e2eEngineId
      if (!e2eId) throw new Error('e2e mode requires e2eEngineId')

      const e2eFactory = this.e2eFactories.get(e2eId)
      if (!e2eFactory) throw new Error(`E2E engine not found: ${e2eId}`)

      emitter.emit('engine-loading', 'Loading translation model...')
      this.e2eEngine = await Promise.resolve(e2eFactory())
      await this.withTimeout(this.e2eEngine.initialize(), ENGINE_INIT_TIMEOUT_MS, 'E2E engine initialization')
    }
  }

  /**
   * Initialize a secondary quality translator for adaptive routing (#547).
   * Called separately from initializeEngines since it's optional.
   */
  async initQualityTranslator(engineId: string, emitter: EventEmitter): Promise<void> {
    const factory = this.translatorFactories.get(engineId)
    if (!factory) throw new Error(`Quality translator engine not found: ${engineId}`)

    emitter.emit('engine-loading', 'Loading quality translation model for adaptive routing...')
    this.qualityTranslator = await Promise.resolve(factory())
    await this.withTimeout(this.qualityTranslator.initialize(), ENGINE_INIT_TIMEOUT_MS, 'Quality translator initialization')
    log.info(`Quality translator initialized: ${engineId}`)
  }

  /**
   * Initialize the draft STT engine for fast interim results (#536).
   * Called separately from initializeEngines since draft STT is optional.
   */
  async initDraftStt(engineId: string, emitter: EventEmitter): Promise<void> {
    const factory = this.sttFactories.get(engineId)
    if (!factory) throw new Error(`Draft STT engine not found: ${engineId}`)

    emitter.emit('engine-loading', 'Loading draft STT model...')
    this.draftSttEngine = await Promise.resolve(factory())
    await this.withTimeout(this.draftSttEngine.initialize(), ENGINE_INIT_TIMEOUT_MS, 'Draft STT initialization')
  }

  /**
   * Initialize the speaker diarizer for multi-speaker identification (#549).
   * Called separately from initializeEngines since diarization is optional.
   */
  async initDiarizer(engineId: string, emitter: EventEmitter): Promise<void> {
    const factory = this.diarizerFactories.get(engineId)
    if (!factory) throw new Error(`Diarizer engine not found: ${engineId}`)

    emitter.emit('engine-loading', 'Loading speaker diarization model...')
    this.diarizer = await Promise.resolve(factory())
    await this.withTimeout(this.diarizer.initialize(), ENGINE_INIT_TIMEOUT_MS, 'Diarizer initialization')
    log.info(`Speaker diarizer initialized: ${engineId}`)
  }

  /** Dispose all active engines and clear references */
  async disposeEngines(): Promise<void> {
    const engines: Array<{ dispose(): Promise<void> } | null> = [
      this.sttEngine, this.translator, this.e2eEngine,
      this.draftSttEngine, this.qualityTranslator, this.diarizer
    ]
    this.sttEngine = null
    this.translator = null
    this.e2eEngine = null
    this.draftSttEngine = null
    this.qualityTranslator = null
    this.diarizer = null

    for (const engine of engines) {
      if (engine) {
        try {
          await engine.dispose()
        } catch (err) {
          log.warn('Error during engine disposal:', err)
        }
      }
    }
  }

  /** Clear config reference (used on initialization failure) */
  clearConfig(): void {
    this.config = null
  }

  /** Run a promise with a timeout */
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    })
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer))
  }
}
