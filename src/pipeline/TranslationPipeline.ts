import { EventEmitter } from 'events'
import type {
  EngineConfig,
  STTEngine,
  TranslatorEngine,
  E2ETranslationEngine,
  SpeakerDiarizer,
  TranslationResult,
  Language,
  SourceLanguage,
  GlossaryEntry
} from '../engines/types'
import { LocalAgreement } from './LocalAgreement'
import { ContextBuffer } from './ContextBuffer'
import { TranslationCache } from './TranslationCache'
import { EngineManager } from './EngineManager'
import { StreamingProcessor } from './StreamingProcessor'
import type { FinalMeta } from './StreamingProcessor'
import { MemoryMonitor } from './MemoryMonitor'
import { createLogger } from '../main/logger'

const log = createLogger('pipeline')

export interface PipelineEvents {
  result: (result: TranslationResult) => void
  'interim-result': (result: TranslationResult) => void
  /** Draft result from hybrid translation mode — shown immediately before LLM refinement */
  'draft-result': (result: TranslationResult) => void
  /** Draft STT interim result — fast Moonshine Tiny JA result before primary STT (#536) */
  'draft-stt-result': (result: TranslationResult) => void
  /** A segment closed without a final result (silence, empty STT, failure); its interim text is stale */
  'segment-dropped': (segmentId: string) => void
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
 * - cascade: STTEngine + TranslatorEngine
 * - e2e: E2ETranslationEngine
 *
 * Audio arrives per speech segment: interim submissions while the segment is
 * being spoken, then exactly one final submission for it.
 *
 * Engines are swappable at runtime via switchEngine().
 *
 * Delegates to:
 * - EngineManager — engine registration, creation, lifecycle
 * - StreamingProcessor — per-segment scheduling of STT and translation
 * - MemoryMonitor — periodic memory usage logging
 */
export class TranslationPipeline extends EventEmitter {
  private _state: PipelineState = PipelineState.IDLE
  private agreement = new LocalAgreement()
  private contextBuffer = new ContextBuffer()
  private translationCache = new TranslationCache()

  // Language configuration
  private sourceLanguage: SourceLanguage = 'auto'
  private targetLanguage: Language = 'en'

  // SimulMT state
  private simulMtEnabled = false
  private simulMtWaitK = 3

  // Draft STT state (#536)
  private draftSttEnabled = false

  // Speaker diarization state (#549)
  private diarizationEnabled = false

  // Processing lock — prevents disposeEngines() while processAudio is in-flight
  private processingCount = 0
  private processingDoneResolvers: (() => void)[] = []

  // Auto-recovery state
  private consecutiveErrors = 0

  // Session generation counter (#719). Bumped on every engine switch / stop so
  // async results scheduled under a previous engine are dropped instead of emitted.
  private generation = 0

  // Glossary terms for context-aware translation
  private glossary: GlossaryEntry[] = []

  // Delegates
  private engineManager = new EngineManager()
  private memoryMonitor = new MemoryMonitor()
  private streaming: StreamingProcessor

  constructor() {
    super()
    this.streaming = new StreamingProcessor({
      emitter: this,
      agreement: this.agreement,
      contextBuffer: this.contextBuffer,
      cache: this.translationCache,
      getSTTEngine: () => this.engineManager.sttEngine,
      getTranslator: () => this.engineManager.translator,
      getE2EEngine: () => this.engineManager.config?.mode === 'e2e' ? this.engineManager.e2eEngine : null,
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
      reportFailure: (err) => this.reportFailure(err),
      reportSuccess: () => { this.consecutiveErrors = 0 },
      getDraftSTTEngine: () => this.draftSttEnabled ? this.engineManager.draftSttEngine : null,
      getDiarizer: () => this.diarizationEnabled ? this.engineManager.diarizer : null,
      getGeneration: () => this.generation
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
    // Cached translations were produced under the old glossary.
    this.translationCache.clear()
  }

  /** Configure source and target languages */
  setLanguageConfig(source: SourceLanguage, target: Language): void {
    const changed = this.sourceLanguage !== source || this.targetLanguage !== target
    this.sourceLanguage = source
    this.targetLanguage = target
    if (changed) {
      this.translationCache.clear()
    }
  }

  /** Configure simultaneous translation (Wait-k policy) */
  setSimulMt(enabled: boolean, waitK: number): void {
    this.simulMtEnabled = enabled
    this.simulMtWaitK = Math.max(1, Math.min(waitK, 10))
  }

  /** Enable or disable draft STT for fast interim results (#536) */
  setDraftSttEnabled(enabled: boolean): void {
    this.draftSttEnabled = enabled
  }

  /** Enable or disable speaker diarization (#549) */
  setDiarizationEnabled(enabled: boolean): void {
    this.diarizationEnabled = enabled
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

  registerDiarizer(id: string, factory: () => SpeakerDiarizer): void {
    this.engineManager.registerDiarizer(id, factory)
  }

  // --- Processing lock ---

  /** Wait until the in-flight streaming job completes */
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
      // stop()-equivalent reset (#719): bump the generation and clear all streaming
      // state so results scheduled under the previous engine are never emitted after
      // the switch (stale LocalAgreement / ContextBuffer / SimulMT output).
      this.generation++
      this.agreement.reset()
      this.contextBuffer.reset()
      this.streaming.reset()
      this.translationCache.clear()
      await this.engineManager.disposeEngines()
      await this.engineManager.initializeEngines(config, this)

      // Initialize draft STT if enabled (#536)
      if (this.draftSttEnabled) {
        try {
          await this.engineManager.initDraftStt('moonshine-tiny-ja', this)
        } catch (err) {
          log.warn('Draft STT initialization failed (non-fatal):', err)
          this.emit('engine-loading', 'Draft STT not available — continuing without fast interim results')
        }
      }

      // Initialize speaker diarizer if enabled (#549)
      if (this.diarizationEnabled && process.platform === 'darwin') {
        try {
          await this.engineManager.initDiarizer('fluid-audio', this)
        } catch (err) {
          log.warn('Speaker diarization initialization failed (non-fatal):', err)
          this.emit('engine-loading', 'Speaker diarization not available — continuing without speaker labels')
        }
      }

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
    // Bump generation so no stale async result is emitted after stop (#719).
    this.generation++
    this.streaming.reset()
    this.agreement.reset()
    this.contextBuffer.reset()
    this.translationCache.clear()
    // Dispose engines to free memory (#211)
    await this.engineManager.disposeEngines()
  }

  // --- Failure handling ---

  /**
   * An engine call failed. Each failure is surfaced as an 'error' event; after
   * MAX_CONSECUTIVE_ERRORS in a row the engines are re-initialized.
   */
  private reportFailure(error: Error): void {
    log.error('Engine failure:', error.message)
    this.emit('error', error)
    this.consecutiveErrors++
    if (this.consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
      this.scheduleRecovery()
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

  /** Submit the audio so far of a segment that is still being spoken */
  async processStreaming(
    audioBuffer: Float32Array,
    sampleRate: number,
    segmentId: string
  ): Promise<TranslationResult | null> {
    if (this._state !== PipelineState.RUNNING || !this.engineManager.config) return null
    return this.streaming.processStreaming(audioBuffer, sampleRate, segmentId)
  }

  /** Submit the complete audio of a segment; each segment is finalized at most once */
  async finalizeStreaming(
    audioChunk: Float32Array,
    sampleRate: number,
    segmentId: string,
    meta?: FinalMeta
  ): Promise<TranslationResult | null> {
    if (!this.running || !this.engineManager.config) {
      log.info(`final ${segmentId}: dropped in state ${this._state}`)
      this.emit('segment-dropped', segmentId)
      return null
    }
    return this.streaming.finalizeStreaming(audioChunk, sampleRate, segmentId, meta)
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
