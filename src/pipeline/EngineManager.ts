import type {
  EngineConfig,
  STTEngine,
  TranslatorEngine,
  E2ETranslationEngine
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

  sttEngine: STTEngine | null = null
  translator: TranslatorEngine | null = null
  e2eEngine: E2ETranslationEngine | null = null
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

  /** Dispose all active engines and clear references */
  async disposeEngines(): Promise<void> {
    const engines = [this.sttEngine, this.translator, this.e2eEngine]
    this.sttEngine = null
    this.translator = null
    this.e2eEngine = null

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
