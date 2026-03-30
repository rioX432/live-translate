import { EventEmitter } from 'events'
import type {
  EngineConfig,
  STTEngine,
  TranslatorEngine,
  E2ETranslationEngine,
  TranslationResult,
  Language,
  SourceLanguage,
  GlossaryEntry
} from '../engines/types'
import { LocalAgreement } from './LocalAgreement'
import { ContextBuffer } from './ContextBuffer'
import { SpeakerTracker } from './SpeakerTracker'
import { EngineManager } from './EngineManager'
import { StreamingProcessor } from './StreamingProcessor'
import { GERProcessor } from './GERProcessor'
import { MemoryMonitor } from './MemoryMonitor'
import { createLogger } from '../main/logger'

const log = createLogger('pipeline')

export interface PipelineEvents {
  result: (result: TranslationResult) => void
  'interim-result': (result: TranslationResult) => void
  /** Draft result from hybrid translation mode — shown immediately before LLM refinement */
  'draft-result': (result: TranslationResult) => void
  /** GER-corrected result — async post-correction of STT errors (#409) */
  'ger-corrected': (result: TranslationResult) => void
  error: (error: Error) => void
  'engine-loading': (message: string) => void
  'engine-ready': () => void
  'state-change': (state: PipelineState) => void
}

/**
 * Pipeline lifecycle states (#52).
 * Valid transitions:
 *   IDLE → INITIALIZING → IDLE → start() → RUNNING (normal lifecycle)
 *   RUNNING → RECOVERING → IDLE → INITIALIZING → IDLE → RUNNING (auto-recovery)
 *   RUNNING → INITIALIZING → RUNNING (hot-swap engine)
 *   any → IDLE (dispose/stop)
 */
export enum PipelineState {
  /** Not running, engines may or may not be loaded */
  IDLE = 'idle',
  /** Engine switch or initialization in progress */
  INITIALIZING = 'initializing',
  /** Running and ready to process audio */
  RUNNING = 'running',
  /** Auto-recovering from consecutive errors */
  RECOVERING = 'recovering'
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
 *
 * Delegates to:
 * - EngineManager — engine registration, creation, lifecycle
 * - StreamingProcessor — streaming audio processing and lock management
 * - MemoryMonitor — periodic memory usage logging
 */
export class TranslationPipeline extends EventEmitter {
  private _state: PipelineState = PipelineState.IDLE
  private agreement = new LocalAgreement()
  private contextBuffer = new ContextBuffer()
  private speakerTracker = new SpeakerTracker()

  // Language configuration
  private sourceLanguage: SourceLanguage = 'auto'
  private targetLanguage: Language = 'en'

  // SimulMT state
  private simulMtEnabled = false
  private simulMtWaitK = 3

  // Batch processing mutex — STT engines assume sequential access (#217)
  private batchLock = false

  // Processing lock — prevents disposeEngines() while processAudio is in-flight
  private processingCount = 0
  private processingDoneResolvers: (() => void)[] = []

  // Auto-recovery state
  private consecutiveErrors = 0

  // Glossary terms for context-aware translation
  private glossary: GlossaryEntry[] = []

  // Delegates
  private engineManager = new EngineManager()
  private memoryMonitor = new MemoryMonitor()
  private streaming: StreamingProcessor
  private ger: GERProcessor

  constructor() {
    super()
    this.streaming = new StreamingProcessor({
      emitter: this,
      agreement: this.agreement,
      contextBuffer: this.contextBuffer,
      speakerTracker: this.speakerTracker,
      getSTTEngine: () => this.engineManager.sttEngine,
      getTranslator: () => this.engineManager.translator,
      getGlossary: () => this.glossary,
      getSimulMtConfig: () => ({ enabled: this.simulMtEnabled, waitK: this.simulMtWaitK }),
      resolveTargetLanguage: (lang) => this.resolveTargetLanguage(lang),
      incrementProcessing: () => { this.processingCount++ },
      decrementProcessing: () => {
        this.processingCount--
        if (this.processingCount === 0) {
          for (const resolve of this.processingDoneResolvers) resolve()
          this.processingDoneResolvers = []
        }
      },
      getGER: () => this.ger
    })
    this.ger = new GERProcessor({
      emitter: this,
      getTranslator: () => this.engineManager.translator,
      getGlossary: () => this.glossary
    })
  }

  // --- State management ---

  get state(): PipelineState {
    return this._state
  }

  private setState(newState: PipelineState): void {
    const prev = this._state
    this._state = newState
    this.emit('state-change', newState)
    log.info(`${prev} → ${newState}`)
  }

  /** Whether the pipeline is actively processing audio */
  get running(): boolean {
    return this._state === PipelineState.RUNNING
  }

  /** Whether the pipeline is in any active state (running or recovering) */
  get active(): boolean {
    return this._state === PipelineState.RUNNING || this._state === PipelineState.RECOVERING
  }

  get currentConfig(): EngineConfig | null {
    return this.engineManager.config
  }

  get sessionStartTime(): number | null {
    return this.memoryMonitor.sessionStartTime
  }

  /** Check if a specific transition is allowed */
  private canTransitionTo(target: PipelineState): boolean {
    switch (target) {
      case PipelineState.INITIALIZING:
        return this._state === PipelineState.IDLE || this._state === PipelineState.RUNNING
      case PipelineState.RUNNING:
        return this._state === PipelineState.INITIALIZING || this._state === PipelineState.RECOVERING
      case PipelineState.RECOVERING:
        return this._state === PipelineState.RUNNING
      case PipelineState.IDLE:
        return true // can always go to IDLE (dispose/stop)
      default:
        return false
    }
  }

  /** Set glossary terms for context-aware translation */
  setGlossary(glossary: GlossaryEntry[]): void {
    this.glossary = glossary
  }

  /** Configure source and target languages */
  setLanguageConfig(source: SourceLanguage, target: Language): void {
    this.sourceLanguage = source
    this.targetLanguage = target
  }

  /** Configure simultaneous translation (Wait-k policy) */
  setSimulMt(enabled: boolean, waitK: number): void {
    this.simulMtEnabled = enabled
    this.simulMtWaitK = Math.max(1, Math.min(waitK, 10))
  }

  /** Enable or disable GER (Generative Error Correction) post-processing (#409) */
  setGEREnabled(enabled: boolean): void {
    this.ger.setEnabled(enabled)
  }

  // --- Engine registration (delegated to EngineManager) ---

  registerSTT(id: string, factory: () => STTEngine): void {
    this.engineManager.registerSTT(id, factory)
  }

  registerTranslator(id: string, factory: () => TranslatorEngine): void {
    this.engineManager.registerTranslator(id, factory)
  }

  registerE2E(id: string, factory: () => E2ETranslationEngine): void {
    this.engineManager.registerE2E(id, factory)
  }

  // --- Processing lock ---

  /** Wait until all in-flight processAudio calls complete */
  private async waitForProcessing(): Promise<void> {
    if (this.processingCount === 0) return
    return new Promise((resolve) => {
      this.processingDoneResolvers.push(resolve)
    })
  }

  // --- Lifecycle ---

  /** Switch to a new engine configuration. Disposes previous engines. */
  async switchEngine(config: EngineConfig): Promise<void> {
    if (!this.canTransitionTo(PipelineState.INITIALIZING)) {
      throw new Error(`Cannot switch engine in state: ${this._state}`)
    }

    const prevState = this._state
    this.setState(PipelineState.INITIALIZING)

    try {
      await this.waitForProcessing()
      await this.engineManager.disposeEngines()
      await this.engineManager.initializeEngines(config, this)

      // If was RUNNING (hot-swap), go back to RUNNING; otherwise stay IDLE until start()
      if (prevState === PipelineState.RUNNING) {
        this.setState(PipelineState.RUNNING)
      } else {
        // Stay in INITIALIZING — caller will call start() to transition to RUNNING
        // Actually, transition to IDLE so start() can be called
        this.setState(PipelineState.IDLE)
      }
      this.emit('engine-ready')
    } catch (err) {
      this.engineManager.clearConfig()
      await this.engineManager.disposeEngines()
      this.setState(PipelineState.IDLE)
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  start(): void {
    if (this._state !== PipelineState.IDLE) {
      log.warn(`Cannot start in state: ${this._state}`)
      return
    }
    this.setState(PipelineState.RUNNING)
    this.consecutiveErrors = 0
    this.memoryMonitor.start()
  }

  async stop(): Promise<void> {
    this.memoryMonitor.stop()
    this.setState(PipelineState.IDLE)
    this.streaming.reset()
    this.ger.reset()
    this.agreement.reset()
    this.contextBuffer.reset()
    this.speakerTracker.reset()
    // Dispose engines to free memory (#211)
    await this.engineManager.disposeEngines()
  }

  // --- Audio processing ---

  async process(audioChunk: Float32Array, sampleRate: number): Promise<TranslationResult | null> {
    if (this._state !== PipelineState.RUNNING || !this.engineManager.config) return null
    if (this.batchLock) return null

    this.processingCount++
    this.batchLock = true
    try {
      let result: TranslationResult | null = null

      if (this.engineManager.config.mode === 'e2e' && this.engineManager.e2eEngine) {
        result = await this.engineManager.e2eEngine.processAudio(audioChunk, sampleRate)
      } else if (this.engineManager.config.mode === 'cascade' && this.engineManager.sttEngine) {
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
        this.scheduleRecovery()
      }

      return null
    } finally {
      this.batchLock = false
      this.processingCount--
      if (this.processingCount === 0) {
        for (const resolve of this.processingDoneResolvers) resolve()
        this.processingDoneResolvers = []
      }
    }
  }

  private async processCascade(
    audioChunk: Float32Array,
    sampleRate: number
  ): Promise<TranslationResult | null> {
    if (!this.engineManager.sttEngine) return null

    const t0 = performance.now()
    const sttResult = await this.engineManager.sttEngine.processAudio(audioChunk, sampleRate)
    const sttMs = (performance.now() - t0).toFixed(0)
    if (!sttResult || !sttResult.isFinal || !sttResult.text.trim()) {
      log.info(`STT: ${sttMs}ms → (no result)`)
      return null
    }
    log.info(`STT: ${sttMs}ms → "${sttResult.text}" [${sttResult.language}]`)

    const targetLang = this.resolveTargetLanguage(sttResult.language)

    if (!this.engineManager.translator) {
      this.emit('error', new Error('Translator engine not initialized'))
      return null
    }

    try {
      const t1 = performance.now()
      const speakerId = sttResult.speakerId ?? this.speakerTracker.update(Date.now())
      const glossary = this.glossary.length > 0 ? this.glossary : undefined
      const translated = await this.engineManager.translator.translate(
        sttResult.text,
        sttResult.language,
        targetLang,
        this.contextBuffer.getContext(glossary, speakerId)
      )
      const translateMs = (performance.now() - t1).toFixed(0)
      log.info(`Translate: ${translateMs}ms → "${translated}"`)

      this.contextBuffer.add(sttResult.text, translated, speakerId)

      // Fire-and-forget GER correction (async, non-blocking)
      this.ger.maybeCorrect(
        sttResult.text,
        sttResult.confidence,
        sttResult.language,
        targetLang,
        Date.now(),
        speakerId
      )

      return {
        sourceText: sttResult.text,
        translatedText: translated,
        sourceLanguage: sttResult.language,
        targetLanguage: targetLang,
        timestamp: Date.now(),
        speakerId,
        confidence: sttResult.confidence
      }
    } catch (translatorErr) {
      log.error('Translator error:', translatorErr)
      this.emit('error', new Error(`Translation failed: ${translatorErr instanceof Error ? translatorErr.message : translatorErr}`))
      return null
    }
  }

  /** Fire-and-forget recovery — does not block the IPC handler (#218) */
  private scheduleRecovery(): void {
    this.attemptRecovery().catch((err) => {
      log.error('Background recovery error:', err)
    })
  }

  private async attemptRecovery(): Promise<void> {
    if (!this.canTransitionTo(PipelineState.RECOVERING) || !this.engineManager.config) return
    this.setState(PipelineState.RECOVERING)

    log.info('Attempting auto-recovery after consecutive errors...')
    this.emit('engine-loading', 'Recovering from errors...')

    try {
      await new Promise((resolve) => setTimeout(resolve, RECOVERY_DELAY_MS))

      // Reset streaming state before re-initializing engines
      this.agreement.reset()
      this.contextBuffer.reset()
      this.streaming.lastTranslatedConfirmed = ''
      this.streaming.simulMtPreviousOutput = ''

      // Temporarily go to IDLE so switchEngine can transition to INITIALIZING
      this.setState(PipelineState.IDLE)
      await this.switchEngine(this.engineManager.config)
      this.consecutiveErrors = 0

      // switchEngine leaves us in IDLE, so start again
      this.setState(PipelineState.RUNNING)
      this.memoryMonitor.start()
      log.info('Auto-recovery successful')
    } catch (err) {
      log.error('Auto-recovery failed:', err)
      this.consecutiveErrors = 0 // reset to prevent re-triggering
      this.setState(PipelineState.IDLE)
      this.emit('error', new Error('Auto-recovery failed. Please restart manually.'))
    }
  }

  // --- Streaming (delegated to StreamingProcessor) ---

  async processStreaming(audioBuffer: Float32Array, sampleRate: number): Promise<TranslationResult | null> {
    if (this._state !== PipelineState.RUNNING || !this.engineManager.config) return null
    if (this.engineManager.config.mode !== 'cascade') return null
    return this.streaming.processStreaming(audioBuffer, sampleRate)
  }

  async finalizeStreaming(audioChunk: Float32Array, sampleRate: number): Promise<TranslationResult | null> {
    if (!this.running || !this.engineManager.config) return null
    if (this.engineManager.config.mode !== 'cascade') return null
    return this.streaming.finalizeStreaming(audioChunk, sampleRate)
  }

  /**
   * Resolve the target language based on user settings and detected source language.
   * When source and target are the same, falls back to ja<->en swap for backward compatibility.
   */
  private resolveTargetLanguage(detectedLang: Language): Language {
    const target = this.targetLanguage
    // If detected language matches target, swap to avoid no-op translation
    if (detectedLang === target) {
      // Backward-compatible fallback: ja<->en
      return detectedLang === 'ja' ? 'en' : 'ja'
    }
    return target
  }

  // --- Cleanup ---

  async dispose(): Promise<void> {
    await this.stop()
    this.removeAllListeners()
  }
}
