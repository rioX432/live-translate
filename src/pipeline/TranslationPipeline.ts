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
import { HybridTranslator } from '../engines/translator/HybridTranslator'
import { LocalAgreement } from './LocalAgreement'
import { ContextBuffer } from './ContextBuffer'
import { SpeakerTracker } from './SpeakerTracker'

export interface PipelineEvents {
  result: (result: TranslationResult) => void
  'interim-result': (result: TranslationResult) => void
  /** Draft result from hybrid translation mode — shown immediately before LLM refinement */
  'draft-result': (result: TranslationResult) => void
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
const ENGINE_INIT_TIMEOUT_MS = 5 * 60_000 // 5 minutes for model download

/**
 * Manages the STT → Translation pipeline.
 * Supports two modes:
 * - cascade: STTEngine + TranslatorEngine (online mode)
 * - e2e: E2ETranslationEngine (offline mode)
 *
 * Engines are swappable at runtime via switchEngine().
 */
export class TranslationPipeline extends EventEmitter {
  private _state: PipelineState = PipelineState.IDLE
  private config: EngineConfig | null = null
  private sttEngine: STTEngine | null = null
  private translator: TranslatorEngine | null = null
  private e2eEngine: E2ETranslationEngine | null = null
  private agreement = new LocalAgreement()
  private contextBuffer = new ContextBuffer()
  private speakerTracker = new SpeakerTracker()
  private lastTranslatedConfirmed = ''

  // Language configuration
  private sourceLanguage: SourceLanguage = 'auto'
  private targetLanguage: Language = 'en'

  // SimulMT state
  private simulMtEnabled = false
  private simulMtWaitK = 3
  private simulMtPreviousOutput = ''

  // Streaming mutex (separate from lifecycle state)
  private streamingLock = false
  private streamingLockResolvers: Array<() => void> = []

  // Batch processing mutex — STT engines assume sequential access (#217)
  private batchLock = false

  // Engine factories — registered externally
  private sttFactories = new Map<string, () => STTEngine>()
  private translatorFactories = new Map<string, () => TranslatorEngine>()
  private e2eFactories = new Map<string, () => E2ETranslationEngine>()

  // Processing lock — prevents disposeEngines() while processAudio is in-flight
  private processingCount = 0
  private processingDoneResolvers: (() => void)[] = []

  // Auto-recovery state
  private consecutiveErrors = 0

  // Glossary terms for context-aware translation
  private glossary: GlossaryEntry[] = []

  // Memory monitoring
  private memoryTimer: ReturnType<typeof setInterval> | null = null
  private startedAt: number | null = null

  // --- State management ---

  get state(): PipelineState {
    return this._state
  }

  private setState(newState: PipelineState): void {
    const prev = this._state
    this._state = newState
    this.emit('state-change', newState)
    console.log(`[pipeline] ${prev} → ${newState}`)
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
    return this.config
  }

  get sessionStartTime(): number | null {
    return this.startedAt
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

  // --- Engine registration ---

  registerSTT(id: string, factory: () => STTEngine): void {
    this.sttFactories.set(id, factory)
  }

  registerTranslator(id: string, factory: () => TranslatorEngine): void {
    this.translatorFactories.set(id, factory)
  }

  registerE2E(id: string, factory: () => E2ETranslationEngine): void {
    this.e2eFactories.set(id, factory)
  }

  /** Run a promise with a timeout (cleans up timer on resolution) */
  private withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    })
    return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer))
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
      await this.disposeEngines()
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

        this.emit('engine-loading', 'Loading STT model...')
        this.sttEngine = await Promise.resolve(sttFactory())
        await this.withTimeout(this.sttEngine.initialize(), ENGINE_INIT_TIMEOUT_MS, 'STT initialization')

        this.emit('engine-loading', 'Initializing translator...')
        this.translator = await Promise.resolve(translatorFactory())
        await this.withTimeout(this.translator.initialize(), ENGINE_INIT_TIMEOUT_MS, 'Translator initialization')

        // Wire up draft callback for hybrid translator (#235)
        if (this.translator instanceof HybridTranslator) {
          this.translator.setOnDraft((draft) => {
            this.emit('draft-result', draft)
          })
        }
      } else if (config.mode === 'e2e') {
        const e2eId = config.e2eEngineId
        if (!e2eId) throw new Error('e2e mode requires e2eEngineId')

        const e2eFactory = this.e2eFactories.get(e2eId)
        if (!e2eFactory) throw new Error(`E2E engine not found: ${e2eId}`)

        this.emit('engine-loading', 'Loading translation model...')
        this.e2eEngine = await Promise.resolve(e2eFactory())
        await this.withTimeout(this.e2eEngine.initialize(), ENGINE_INIT_TIMEOUT_MS, 'E2E engine initialization')
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
      this.config = null
      await this.disposeEngines()
      this.setState(PipelineState.IDLE)
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  start(): void {
    if (this._state !== PipelineState.IDLE) {
      console.warn(`[pipeline] Cannot start in state: ${this._state}`)
      return
    }
    this.setState(PipelineState.RUNNING)
    this.startedAt = Date.now()
    this.consecutiveErrors = 0
    this.startMemoryMonitor()
  }

  async stop(): Promise<void> {
    this.stopMemoryMonitor()
    this.setState(PipelineState.IDLE)
    this.startedAt = null
    this.streamingLock = false
    for (const r of this.streamingLockResolvers) r()
    this.streamingLockResolvers = []
    this.agreement.reset()
    this.contextBuffer.reset()
    this.speakerTracker.reset()
    this.lastTranslatedConfirmed = ''
    this.simulMtPreviousOutput = ''
    // Dispose engines to free memory (#211)
    await this.disposeEngines()
  }

  // --- Audio processing ---

  async process(audioChunk: Float32Array, sampleRate: number): Promise<TranslationResult | null> {
    if (this._state !== PipelineState.RUNNING || !this.config) return null
    if (this.batchLock) return null

    this.processingCount++
    this.batchLock = true
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
    if (!this.sttEngine) return null

    const sttResult = await this.sttEngine.processAudio(audioChunk, sampleRate)
    if (!sttResult || !sttResult.isFinal || !sttResult.text.trim()) return null

    const targetLang = this.resolveTargetLanguage(sttResult.language)

    if (!this.translator) {
      this.emit('error', new Error('Translator engine not initialized'))
      return null
    }

    try {
      const speakerId = sttResult.speakerId ?? this.speakerTracker.update(Date.now())
      const glossary = this.glossary.length > 0 ? this.glossary : undefined
      const translated = await this.translator.translate(
        sttResult.text,
        sttResult.language,
        targetLang,
        this.contextBuffer.getContext(glossary, speakerId)
      )

      this.contextBuffer.add(sttResult.text, translated, speakerId)

      return {
        sourceText: sttResult.text,
        translatedText: translated,
        sourceLanguage: sttResult.language,
        targetLanguage: targetLang,
        timestamp: Date.now(),
        speakerId
      }
    } catch (translatorErr) {
      console.error('[pipeline] Translator error:', translatorErr)
      this.emit('error', new Error(`Translation failed: ${translatorErr instanceof Error ? translatorErr.message : translatorErr}`))
      return null
    }
  }

  /** Fire-and-forget recovery — does not block the IPC handler (#218) */
  private scheduleRecovery(): void {
    this.attemptRecovery().catch((err) => {
      console.error('[pipeline] Background recovery error:', err)
    })
  }

  private async attemptRecovery(): Promise<void> {
    if (!this.canTransitionTo(PipelineState.RECOVERING) || !this.config) return
    this.setState(PipelineState.RECOVERING)

    console.log('[pipeline] Attempting auto-recovery after consecutive errors...')
    this.emit('engine-loading', 'Recovering from errors...')

    try {
      await new Promise((resolve) => setTimeout(resolve, RECOVERY_DELAY_MS))

      // Reset streaming state before re-initializing engines
      this.agreement.reset()
      this.contextBuffer.reset()
      this.lastTranslatedConfirmed = ''
      this.simulMtPreviousOutput = ''

      // Temporarily go to IDLE so switchEngine can transition to INITIALIZING
      this.setState(PipelineState.IDLE)
      await this.switchEngine(this.config)
      this.consecutiveErrors = 0

      // switchEngine leaves us in IDLE, so start again
      this.setState(PipelineState.RUNNING)
      this.startMemoryMonitor()
      console.log('[pipeline] Auto-recovery successful')
    } catch (err) {
      console.error('[pipeline] Auto-recovery failed:', err)
      this.consecutiveErrors = 0 // reset to prevent re-triggering
      this.setState(PipelineState.IDLE)
      this.emit('error', new Error('Auto-recovery failed. Please restart manually.'))
    }
  }

  // --- Streaming ---

  async processStreaming(audioBuffer: Float32Array, sampleRate: number): Promise<TranslationResult | null> {
    if (this._state !== PipelineState.RUNNING || !this.config) return null
    if (this.config.mode !== 'cascade' || !this.sttEngine) return null
    // Drop chunk if another streaming call is in-flight — acceptable because
    // the rolling buffer re-sends accumulated audio on the next interval (#103)
    if (this.streamingLock) return null

    this.processingCount++
    this.streamingLock = true
    try {
      const sttResult = await this.sttEngine.processAudio(audioBuffer, sampleRate)
      if (!sttResult || !sttResult.text.trim()) {
        // Reset agreement on silence to prevent stale state accumulation (#75)
        this.agreement.reset()
        this.lastTranslatedConfirmed = ''
        this.simulMtPreviousOutput = ''
        return null
      }

      const agreement = this.agreement.update(sttResult.text)
      const targetLang = this.resolveTargetLanguage(sttResult.language)

      const speakerId = sttResult.speakerId ?? this.speakerTracker.update(Date.now())
      const glossary = this.glossary.length > 0 ? this.glossary : undefined

      let translatedText = ''

      // SimulMT path: use incremental translation with Wait-k policy
      if (
        this.simulMtEnabled &&
        this.translator?.translateIncremental &&
        agreement.confirmedText.trim()
      ) {
        const wordCount = this.countWords(agreement.confirmedText, sttResult.language)
        if (wordCount >= this.simulMtWaitK) {
          translatedText = await this.translator.translateIncremental(
            agreement.confirmedText,
            this.simulMtPreviousOutput,
            sttResult.language,
            targetLang,
            this.contextBuffer.getContext(glossary, speakerId)
          )
          this.simulMtPreviousOutput = translatedText
          this.lastTranslatedConfirmed = translatedText
        } else {
          translatedText = this.simulMtPreviousOutput || this.lastTranslatedConfirmed
        }
      } else if (agreement.newConfirmed && this.translator) {
        // Standard path: translate only when new confirmed text appears
        translatedText = await this.translator.translate(
          agreement.confirmedText,
          sttResult.language,
          targetLang,
          this.contextBuffer.getContext(glossary, speakerId)
        )
        this.lastTranslatedConfirmed = translatedText
      } else {
        translatedText = this.lastTranslatedConfirmed
      }

      const interimResult: TranslationResult = {
        sourceText: agreement.confirmedText + agreement.interimText,
        translatedText,
        sourceLanguage: sttResult.language,
        targetLanguage: targetLang,
        timestamp: Date.now(),
        isInterim: true,
        speakerId
      }

      this.emit('interim-result', interimResult)
      return interimResult
    } catch (err) {
      this.emit('error', err instanceof Error ? err : new Error(String(err)))
      return null
    } finally {
      this.streamingLock = false
      this.processingCount--
      if (this.processingCount === 0) {
        for (const resolve of this.processingDoneResolvers) resolve()
        this.processingDoneResolvers = []
      }
      for (const r of this.streamingLockResolvers) r()
      this.streamingLockResolvers = []
    }
  }

  async finalizeStreaming(audioChunk: Float32Array, sampleRate: number): Promise<TranslationResult | null> {
    if (!this.running || !this.config) return null
    if (this.config.mode !== 'cascade' || !this.sttEngine) return null

    if (this.streamingLock) {
      await new Promise<void>((resolve) => {
        this.streamingLockResolvers.push(resolve)
      })
    }
    this.processingCount++
    this.streamingLock = true

    try {
      const sttResult = await this.sttEngine.processAudio(audioChunk, sampleRate)
      if (!sttResult || !sttResult.text.trim()) {
        this.agreement.reset()
        this.lastTranslatedConfirmed = ''
        this.simulMtPreviousOutput = ''
        return null
      }

      const agreement = this.agreement.finalize(sttResult.text)
      const targetLang = this.resolveTargetLanguage(sttResult.language)

      const speakerId = sttResult.speakerId ?? this.speakerTracker.update(Date.now())
      const glossary = this.glossary.length > 0 ? this.glossary : undefined

      let translatedText = ''
      if (this.translator && agreement.confirmedText.trim()) {
        translatedText = await this.translator.translate(
          agreement.confirmedText,
          sttResult.language,
          targetLang,
          this.contextBuffer.getContext(glossary, speakerId)
        )
        this.contextBuffer.add(agreement.confirmedText, translatedText, speakerId)
      }

      this.lastTranslatedConfirmed = ''
      this.simulMtPreviousOutput = ''
      const result: TranslationResult = {
        sourceText: agreement.confirmedText,
        translatedText,
        sourceLanguage: sttResult.language,
        targetLanguage: targetLang,
        timestamp: Date.now(),
        isInterim: false,
        speakerId
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
      this.processingCount--
      if (this.processingCount === 0) {
        for (const resolve of this.processingDoneResolvers) resolve()
        this.processingDoneResolvers = []
      }
      for (const r of this.streamingLockResolvers) r()
      this.streamingLockResolvers = []
    }
  }

  /**
   * Count words in text. For CJK text (Japanese/Chinese/Korean), count characters
   * since there are no space-delimited word boundaries.
   */
  private countWords(text: string, language: Language): number {
    if (language === 'ja' || language === 'zh') {
      // For Japanese/Chinese, each character roughly corresponds to a morpheme
      return text.replace(/\s/g, '').length
    }
    // Korean has spaces between words, but character count is a better proxy for SimulMT
    if (language === 'ko') {
      return text.replace(/\s/g, '').length
    }
    return text.trim().split(/\s+/).filter(Boolean).length
  }

  /**
   * Resolve the target language based on user settings and detected source language.
   * When source and target are the same, falls back to ja↔en swap for backward compatibility.
   */
  private resolveTargetLanguage(detectedLang: Language): Language {
    const target = this.targetLanguage
    // If detected language matches target, swap to avoid no-op translation
    if (detectedLang === target) {
      // Backward-compatible fallback: ja↔en
      return detectedLang === 'ja' ? 'en' : 'ja'
    }
    return target
  }

  // --- Memory monitoring ---

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

  // --- Cleanup ---

  private async disposeEngines(): Promise<void> {
    const engines = [this.sttEngine, this.translator, this.e2eEngine]
    this.sttEngine = null
    this.translator = null
    this.e2eEngine = null

    for (const engine of engines) {
      if (engine) {
        try {
          await engine.dispose()
        } catch (err) {
          console.warn('[pipeline] Error during engine disposal:', err)
        }
      }
    }
  }

  async dispose(): Promise<void> {
    await this.stop()
    this.removeAllListeners()
  }
}
