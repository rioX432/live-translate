import type { EventEmitter } from 'events'
import type {
  TranslationResult,
  Language,
  GlossaryEntry,
  TranslatorEngine,
  SpeakerDiarizer,
  DiarizationResult,
  E2ETranslationEngine,
  STTResult
} from '../engines/types'
import type { STTEngine } from '../engines/types'
import type { LocalAgreement } from './LocalAgreement'
import type { ContextBuffer } from './ContextBuffer'
import type { TranslationCache } from './TranslationCache'
import { SegmentTracker } from './SegmentTracker'
import { isLowEnergy } from './audio-energy'
import { detectClauseBoundary, countUnits } from './ClauseBoundaryDetector'
import { createLogger } from '../main/logger'

const log = createLogger('pipeline:stream')

/** Debounce delay before translating interim text (ms) */
const TRANSLATE_DEBOUNCE_MS = 1000

export interface StreamingDeps {
  readonly emitter: EventEmitter
  readonly agreement: LocalAgreement
  readonly contextBuffer: ContextBuffer
  readonly cache: TranslationCache
  getSTTEngine(): STTEngine | null
  getTranslator(): TranslatorEngine | null
  /** Set only in e2e mode; finals then go through the e2e engine and interims are skipped */
  getE2EEngine?(): E2ETranslationEngine | null
  getGlossary(): GlossaryEntry[]
  getSimulMtConfig(): { enabled: boolean; waitK: number }
  resolveTargetLanguage(detectedLang: Language): Language
  /** Notify that processing count changed */
  incrementProcessing(): void
  decrementProcessing(): void
  /** An engine call failed; the pipeline surfaces it and decides on recovery */
  reportFailure(error: Error): void
  /** An engine call succeeded; resets the pipeline's consecutive-failure count */
  reportSuccess(): void
  /** Draft STT engine for fast interim results (#536) */
  getDraftSTTEngine?(): STTEngine | null
  /** Speaker diarizer for multi-speaker identification (#549) */
  getDiarizer?(): SpeakerDiarizer | null
  /** Current pipeline session generation — used to drop stale async emits (#719) */
  getGeneration?(): number
}

export interface FinalMeta {
  /** Wall-clock ms when the audio source detected the end of speech */
  speechEndedAt?: number
}

interface Job {
  kind: 'interim' | 'final'
  segmentId: string
  audio: Float32Array
  sampleRate: number
  meta: FinalMeta
  submittedAt: number
  resolve: (result: TranslationResult | null) => void
}

/**
 * Runs streaming STT/translation per speech segment.
 *
 * Every audio submission carries the id of the VAD segment it belongs to.
 * Jobs run one at a time (STT engines assume sequential access, #217): queued
 * finals always run, in arrival order, before any interim; only the newest
 * interim is kept because each interim carries the whole segment so far.
 * SegmentTracker guarantees one final per segment and stops interim output for
 * a segment once its final is claimed.
 */
export class StreamingProcessor {
  private tracker = new SegmentTracker()
  private finalQueue: Job[] = []
  private pendingInterim: Job | null = null
  private busy = false

  /** Segment whose interim state (agreement, partial translations) is held below */
  private currentSegmentId: string | null = null

  private lastTranslatedConfirmed = ''
  private simulMtPreviousOutput = ''

  /** Debounced translation: timer and last source text for change detection */
  private translateDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private lastSourceTextForTranslate = ''

  /** SimulMT state: last boundary we translated up to (#550) */
  private simulMtLastBoundaryText = ''
  /** SimulMT: in-flight translation promise to prevent concurrent requests */
  private simulMtInFlight = false

  /** Last diarization result for merging with STT output (#549) */
  private lastDiarization: { segmentId: string; result: DiarizationResult } | null = null

  /** Clause-level overlap: source text already sent for translation (#615) */
  private clauseTranslatedPrefix = ''
  /** Clause-level overlap: translation result for the translated prefix (#615) */
  private clauseTranslation = ''
  /** Clause-level overlap: in-flight flag to prevent concurrent clause translations */
  private clauseTranslationInFlight = false

  private deps: StreamingDeps

  constructor(deps: StreamingDeps) {
    this.deps = deps
  }

  /**
   * Whether a result scheduled under generation `gen` may still be emitted (#719).
   * Returns true when generation tracking is unavailable (no getGeneration dep).
   */
  private isCurrentGeneration(gen: number | undefined): boolean {
    return gen === undefined || this.deps.getGeneration?.() === gen
  }

  /** Whether async interim output for `segmentId`, scheduled under `gen`, may be emitted */
  private mayEmitInterim(segmentId: string, gen: number | undefined): boolean {
    return this.isCurrentGeneration(gen) && this.tracker.mayEmitInterim(segmentId)
  }

  /** Reset all streaming state and drop queued work */
  reset(): void {
    for (const job of this.finalQueue) job.resolve(null)
    this.finalQueue = []
    this.pendingInterim?.resolve(null)
    this.pendingInterim = null
    this.tracker.reset()
    this.resetSegmentState()
    this.lastDiarization = null
  }

  /** Clear per-segment interim state so nothing leaks into the next segment */
  private resetSegmentState(): void {
    this.currentSegmentId = null
    this.deps.agreement.reset()
    this.lastTranslatedConfirmed = ''
    this.simulMtPreviousOutput = ''
    if (this.translateDebounceTimer) {
      clearTimeout(this.translateDebounceTimer)
      this.translateDebounceTimer = null
    }
    this.lastSourceTextForTranslate = ''
    this.simulMtLastBoundaryText = ''
    this.simulMtInFlight = false
    this.clauseTranslatedPrefix = ''
    this.clauseTranslation = ''
    this.clauseTranslationInFlight = false

    // Reset persistent SimulMT session in worker
    const translator = this.deps.getTranslator()
    if (translator?.resetSimulMtSession) {
      translator.resetSimulMtSession()
    }
  }

  private enterSegment(segmentId: string): void {
    if (this.currentSegmentId === segmentId) return
    this.resetSegmentState()
    this.currentSegmentId = segmentId
  }

  /** Submit the audio of a segment that is still being spoken. */
  processStreaming(
    audioBuffer: Float32Array,
    sampleRate: number,
    segmentId: string
  ): Promise<TranslationResult | null> {
    if (this.deps.getE2EEngine?.()) return Promise.resolve(null)
    if (!this.tracker.touchInterim(segmentId)) return Promise.resolve(null)
    return new Promise((resolve) => {
      // The newest interim carries the whole segment so far, so it supersedes any older one.
      this.pendingInterim?.resolve(null)
      this.pendingInterim = {
        kind: 'interim', segmentId, audio: audioBuffer, sampleRate, meta: {}, submittedAt: Date.now(), resolve
      }
      this.pump()
    })
  }

  /** Submit the complete audio of a segment. Only the first final per segment is processed. */
  finalizeStreaming(
    audioChunk: Float32Array,
    sampleRate: number,
    segmentId: string,
    meta: FinalMeta = {}
  ): Promise<TranslationResult | null> {
    if (!this.tracker.beginFinalize(segmentId)) {
      log.info(`final ${segmentId}: duplicate ignored`)
      return Promise.resolve(null)
    }
    if (this.pendingInterim?.segmentId === segmentId) {
      this.pendingInterim.resolve(null)
      this.pendingInterim = null
    }
    return new Promise((resolve) => {
      this.finalQueue.push({
        kind: 'final', segmentId, audio: audioChunk, sampleRate, meta, submittedAt: Date.now(), resolve
      })
      this.pump()
    })
  }

  private nextJob(): Job | null {
    const final = this.finalQueue.shift()
    if (final) return final
    const interim = this.pendingInterim
    this.pendingInterim = null
    if (interim && !this.tracker.mayEmitInterim(interim.segmentId)) {
      interim.resolve(null)
      return null
    }
    return interim
  }

  private pump(): void {
    if (this.busy) return
    const job = this.nextJob()
    if (!job) return
    this.busy = true
    this.deps.incrementProcessing()
    const run = job.kind === 'final' ? this.runFinal(job) : this.runInterim(job)
    run
      .then((result) => job.resolve(result), (err) => {
        log.error('Unexpected streaming job error:', err)
        job.resolve(null)
      })
      .finally(() => {
        this.busy = false
        this.deps.decrementProcessing()
        this.pump()
      })
  }

  /** Run STT, reporting failures to the pipeline. Returns undefined when STT threw. */
  private async transcribe(
    engine: STTEngine,
    audio: Float32Array,
    sampleRate: number
  ): Promise<STTResult | null | undefined> {
    try {
      const result = await engine.processAudio(audio, sampleRate)
      this.deps.reportSuccess()
      return result
    } catch (err) {
      this.deps.reportFailure(err instanceof Error ? err : new Error(String(err)))
      return undefined
    }
  }

  private async runInterim(job: Job): Promise<TranslationResult | null> {
    const { segmentId, audio: audioBuffer, sampleRate } = job
    const sttEngine = this.deps.getSTTEngine()
    if (!sttEngine) return null
    if (isLowEnergy(audioBuffer, sampleRate)) return null

    const gen = this.deps.getGeneration?.()
    this.enterSegment(segmentId)

    // Fire draft STT in parallel for fast interim results (#536)
    const draftSttEngine = this.deps.getDraftSTTEngine?.()
    if (draftSttEngine) {
      this.runDraftStt(draftSttEngine, audioBuffer, sampleRate, segmentId)
    }

    // Fire diarization in parallel with STT (#549)
    const diarizer = this.deps.getDiarizer?.()
    if (diarizer) {
      this.runDiarization(diarizer, audioBuffer, sampleRate, segmentId)
    }

    const t0 = performance.now()
    const sttResult = await this.transcribe(sttEngine, audioBuffer, sampleRate)
    const sttMs = (performance.now() - t0).toFixed(0)
    if (!this.mayEmitInterim(segmentId, gen)) return null
    if (!sttResult || !sttResult.text.trim()) {
      log.info(`STT: ${sttMs}ms → (no result, ${(audioBuffer.length / sampleRate).toFixed(1)}s audio)`)
      return null
    }
    log.info(`STT: ${sttMs}ms → ${sttResult.text.length} chars [${sttResult.language}]`)

    const agreement = this.deps.agreement.update(sttResult.text)
    const targetLang = this.deps.resolveTargetLanguage(sttResult.language)

    const fullSourceText = agreement.confirmedText + agreement.interimText

    const simulMtConfig = this.deps.getSimulMtConfig()
    const translator = this.deps.getTranslator()
    const useSimulMt = simulMtConfig.enabled && translator?.translateSimulMt

    if (useSimulMt) {
      // SimulMT mode (#550): translate at clause boundaries using KV cache reuse
      this.handleSimulMtStreaming(
        segmentId,
        fullSourceText,
        sttResult.language,
        targetLang,
        agreement.confirmedText,
        agreement.interimText,
        simulMtConfig.waitK
      )
    } else {
      // Fire clause-level overlap translation when new confirmed text is available (#615).
      // This runs in parallel (fire-and-forget) so translation starts before STT
      // finishes the next chunk, reducing perceived latency.
      if (agreement.newConfirmed) {
        this.runClauseTranslation(
          segmentId,
          agreement.confirmedText,
          fullSourceText,
          sttResult.language,
          targetLang
        )
      }

      // Standard debounced translation: schedule translation when source text stabilizes for 1s.
      // This avoids translating on every interim update while still translating
      // during continuous speech (at natural pauses / breathing points).
      if (fullSourceText !== this.lastSourceTextForTranslate) {
        this.lastSourceTextForTranslate = fullSourceText
        if (this.translateDebounceTimer) clearTimeout(this.translateDebounceTimer)
        this.translateDebounceTimer = setTimeout(() => {
          this.translateDebounceTimer = null
          const dbTranslator = this.deps.getTranslator()
          if (!dbTranslator || !fullSourceText.trim()) return
          const glossaryEntries = this.deps.getGlossary()
          const glossary = glossaryEntries.length > 0 ? glossaryEntries : undefined
          const ctx = this.deps.contextBuffer.getContext(glossary)

          // Use SSBD for re-translation when we have a previous translation,
          // since most of the output likely remains valid (#607)
          const translatePromise = (dbTranslator.translateSSBD && this.lastTranslatedConfirmed)
            ? dbTranslator.translateSSBD(
                fullSourceText,
                this.lastTranslatedConfirmed,
                sttResult.language,
                targetLang,
                ctx
              ).catch((ssbdErr) => {
                log.warn('SSBD debounced translation failed, falling back:', ssbdErr)
                return dbTranslator.translate(fullSourceText, sttResult.language, targetLang, ctx)
              })
            : dbTranslator.translate(fullSourceText, sttResult.language, targetLang, ctx)

          translatePromise.then((translated) => {
            // Drop stale results before mutating shared state, so neither an engine
            // switch (#719) nor the segment's final can be overwritten by this one.
            if (!this.mayEmitInterim(segmentId, gen)) return
            this.lastTranslatedConfirmed = translated
            const debouncedResult: TranslationResult = {
              segmentId,
              sourceText: fullSourceText,
              confirmedText: agreement.confirmedText,
              interimText: agreement.interimText,
              translatedText: translated,
              sourceLanguage: sttResult.language,
              targetLanguage: targetLang,
              timestamp: Date.now(),
              isInterim: true
            }
            this.deps.emitter.emit('interim-result', debouncedResult)
          }).catch((err) => {
            log.warn('Debounced translation failed:', err)
          })
        }, TRANSLATE_DEBOUNCE_MS)
      }
    }

    const diarization = this.diarizationFor(segmentId)
    const interimResult: TranslationResult = {
      segmentId,
      sourceText: fullSourceText,
      confirmedText: agreement.confirmedText,
      interimText: agreement.interimText,
      translatedText: this.lastTranslatedConfirmed,
      sourceLanguage: sttResult.language,
      targetLanguage: targetLang,
      timestamp: Date.now(),
      isInterim: true,
      ...(diarization && {
        speakerLabel: diarization.speakerLabel,
        speakerIndex: diarization.speakerIndex
      })
    }

    this.deps.emitter.emit('interim-result', interimResult)
    return interimResult
  }

  private async runFinal(job: Job): Promise<TranslationResult | null> {
    const { segmentId, audio: audioChunk, sampleRate, meta } = job
    const gen = this.deps.getGeneration?.()
    const startedAt = Date.now()
    let emitted: TranslationResult | null = null
    try {
      if (isLowEnergy(audioChunk, sampleRate)) {
        log.info(`final ${segmentId}: below speech energy, skipped`)
        return null
      }
      const e2e = this.deps.getE2EEngine?.()
      if (e2e) {
        emitted = await this.runFinalE2E(e2e, job, gen, startedAt)
        return emitted
      }

      const sttEngine = this.deps.getSTTEngine()
      if (!sttEngine) return null

      const t0 = performance.now()
      const sttResult = await this.transcribe(sttEngine, audioChunk, sampleRate)
      const sttMs = Math.round(performance.now() - t0)
      if (!this.isCurrentGeneration(gen)) return null
      if (!sttResult || !sttResult.text.trim()) {
        log.info(`final ${segmentId}: STT ${sttMs}ms → (no result)`)
        return null
      }

      // Interim state is only meaningful when it was built for this same segment.
      const ownsInterimState = this.currentSegmentId === segmentId
      const sourceText = ownsInterimState
        ? this.deps.agreement.finalize(sttResult.text).confirmedText
        : sttResult.text
      const simulMtPrevious = ownsInterimState ? this.simulMtPreviousOutput : ''
      if (ownsInterimState) this.resetSegmentState()

      const targetLang = this.deps.resolveTargetLanguage(sttResult.language)
      const t1 = performance.now()
      const { translatedText, translationStage } = await this.translateFinal(
        sourceText, sttResult.language, targetLang, simulMtPrevious
      )
      const translateMs = Math.round(performance.now() - t1)
      if (!this.isCurrentGeneration(gen)) return null

      const diarization = this.diarizationFor(segmentId)
      const emittedAt = Date.now()
      const result: TranslationResult = {
        segmentId,
        sourceText,
        translatedText,
        sourceLanguage: sttResult.language,
        targetLanguage: targetLang,
        timestamp: emittedAt,
        isInterim: false,
        confidence: sttResult.confidence,
        timings: this.timings(job, startedAt, sttMs, translateMs, emittedAt),
        ...(meta.speechEndedAt !== undefined && { speechEndedAt: meta.speechEndedAt }),
        ...(translationStage && { translationStage }),
        ...(diarization && {
          speakerLabel: diarization.speakerLabel,
          speakerIndex: diarization.speakerIndex
        })
      }
      this.logFinal(result)
      this.deps.emitter.emit('result', result)
      emitted = result
      return result
    } finally {
      this.tracker.markFinalized(segmentId)
      if (!emitted && this.isCurrentGeneration(gen)) {
        this.deps.emitter.emit('segment-dropped', segmentId)
      }
    }
  }

  private async runFinalE2E(
    engine: E2ETranslationEngine,
    job: Job,
    gen: number | undefined,
    startedAt: number
  ): Promise<TranslationResult | null> {
    const t0 = performance.now()
    let raw: TranslationResult | null
    try {
      raw = await engine.processAudio(job.audio, job.sampleRate)
      this.deps.reportSuccess()
    } catch (err) {
      this.deps.reportFailure(err instanceof Error ? err : new Error(String(err)))
      return null
    }
    const sttMs = Math.round(performance.now() - t0)
    if (!raw || !this.isCurrentGeneration(gen)) return null
    const emittedAt = Date.now()
    const result: TranslationResult = {
      ...raw,
      segmentId: job.segmentId,
      isInterim: false,
      timings: this.timings(job, startedAt, sttMs, 0, emittedAt),
      ...(job.meta.speechEndedAt !== undefined && { speechEndedAt: job.meta.speechEndedAt })
    }
    this.logFinal(result)
    this.deps.emitter.emit('result', result)
    return result
  }

  /**
   * Translate a finalized utterance. A translation failure is reported but the
   * utterance is still emitted with its source text, so the subtitle is not lost.
   */
  private async translateFinal(
    sourceText: string,
    sourceLang: Language,
    targetLang: Language,
    simulMtPrevious: string
  ): Promise<{ translatedText: string; translationStage?: 'simulmt-revised' }> {
    const translator = this.deps.getTranslator()
    if (!translator || !sourceText.trim()) return { translatedText: '' }

    const glossaryEntries = this.deps.getGlossary()
    const glossary = glossaryEntries.length > 0 ? glossaryEntries : undefined
    const simulMtConfig = this.deps.getSimulMtConfig()
    try {
      if (simulMtConfig.enabled && translator.translateSimulMt) {
        // SimulMT revision: retranslate the full clause for accuracy (#550)
        const translatedText = await translator.translateSimulMt(
          sourceText,
          simulMtPrevious,
          sourceLang,
          targetLang,
          true, // revision mode — full clause available
          this.deps.contextBuffer.getContext(glossary)
        )
        translator.resetSimulMtSession?.()
        this.deps.contextBuffer.add(sourceText, translatedText)
        return { translatedText, translationStage: 'simulmt-revised' }
      }

      const cached = this.deps.cache.get(sourceText, sourceLang, targetLang)
      const translatedText = cached ?? await translator.translate(
        sourceText,
        sourceLang,
        targetLang,
        this.deps.contextBuffer.getContext(glossary)
      )
      if (cached === undefined) this.deps.cache.set(sourceText, sourceLang, targetLang, translatedText)
      this.deps.contextBuffer.add(sourceText, translatedText)
      return { translatedText }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.deps.reportFailure(new Error(`Translation failed: ${message}`))
      return { translatedText: '' }
    }
  }

  private timings(
    job: Job,
    startedAt: number,
    sttMs: number,
    translateMs: number,
    emittedAt: number
  ): NonNullable<TranslationResult['timings']> {
    return {
      queueMs: startedAt - job.submittedAt,
      sttMs,
      translateMs,
      ...(job.meta.speechEndedAt !== undefined && {
        speechEndToResultMs: emittedAt - job.meta.speechEndedAt
      })
    }
  }

  private logFinal(result: TranslationResult): void {
    const t = result.timings
    const endToEnd = t?.speechEndToResultMs !== undefined ? `, speech end → result ${t.speechEndToResultMs}ms` : ''
    log.info(
      `final ${result.segmentId}: ${result.sourceText.length} chars, queue ${t?.queueMs}ms, ` +
      `STT ${t?.sttMs}ms, translate ${t?.translateMs}ms${endToEnd}`
    )
  }

  private diarizationFor(segmentId: string): DiarizationResult | null {
    return this.lastDiarization?.segmentId === segmentId ? this.lastDiarization.result : null
  }

  /**
   * Handle SimulMT streaming translation (#550).
   *
   * Instead of debouncing for 1s, translates at clause/phrase boundaries
   * detected by the ClauseBoundaryDetector. Uses translateSimulMt() which
   * maintains a persistent KV cache session for lower latency.
   *
   * Translation triggers:
   * 1. New clause boundary detected (particle-based for JA, whitespace for EN)
   * 2. Enough units accumulated beyond waitK threshold
   * 3. Source text changed since last boundary translation
   */
  private handleSimulMtStreaming(
    segmentId: string,
    fullSourceText: string,
    sourceLang: Language,
    targetLang: Language,
    confirmedText: string,
    interimText: string,
    waitK: number
  ): void {
    const translator = this.deps.getTranslator()
    if (!translator?.translateSimulMt || !fullSourceText.trim()) return

    // Skip if a SimulMT request is already in-flight
    if (this.simulMtInFlight) return

    // Check if we have enough units to start translating (wait-k policy)
    const unitCount = countUnits(fullSourceText, sourceLang)
    if (unitCount < waitK) return

    // Detect clause boundary in the source text
    const boundary = detectClauseBoundary(fullSourceText, sourceLang)
    const textToTranslate = boundary ? boundary.stablePrefix : fullSourceText

    // Skip if we already translated this exact boundary text
    if (textToTranslate === this.simulMtLastBoundaryText) return

    this.simulMtLastBoundaryText = textToTranslate
    this.simulMtInFlight = true

    const gen = this.deps.getGeneration?.()
    const glossaryEntries = this.deps.getGlossary()
    const glossary = glossaryEntries.length > 0 ? glossaryEntries : undefined

    translator.translateSimulMt(
      textToTranslate,
      this.simulMtPreviousOutput,
      sourceLang,
      targetLang,
      false, // not a revision — incremental
      this.deps.contextBuffer.getContext(glossary)
    ).then((translated) => {
      if (!this.mayEmitInterim(segmentId, gen)) return

      this.simulMtPreviousOutput = translated
      this.lastTranslatedConfirmed = translated

      const simulMtResult: TranslationResult = {
        segmentId,
        sourceText: fullSourceText,
        confirmedText,
        interimText,
        translatedText: translated,
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
        timestamp: Date.now(),
        isInterim: true,
        translationStage: 'simulmt-partial'
      }

      this.deps.emitter.emit('interim-result', simulMtResult)
    }).catch((err) => {
      log.warn('SimulMT translation failed:', err)
    }).finally(() => {
      if (this.currentSegmentId === segmentId) this.simulMtInFlight = false
    })
  }

  /**
   * Run draft STT (Moonshine Tiny JA) in parallel with primary STT.
   * Emits result as 'draft-stt-result' immediately for fast interim display (#536).
   * Fire-and-forget — errors are logged but do not affect primary pipeline.
   */
  private runDraftStt(
    draftEngine: STTEngine,
    audioBuffer: Float32Array,
    sampleRate: number,
    segmentId: string
  ): void {
    const t0 = performance.now()
    const gen = this.deps.getGeneration?.()
    draftEngine.processAudio(audioBuffer, sampleRate)
      .then((draftResult) => {
        const draftMs = (performance.now() - t0).toFixed(0)
        if (!draftResult || !draftResult.text.trim()) {
          log.info(`Draft STT: ${draftMs}ms → (no result)`)
          return
        }
        log.info(`Draft STT: ${draftMs}ms → ${draftResult.text.length} chars [${draftResult.language}]`)

        if (!this.mayEmitInterim(segmentId, gen)) return

        const targetLang = this.deps.resolveTargetLanguage(draftResult.language)

        const draftTranslationResult: TranslationResult = {
          segmentId,
          sourceText: draftResult.text,
          translatedText: '', // Draft STT only provides source text — no translation yet
          sourceLanguage: draftResult.language,
          targetLanguage: targetLang,
          timestamp: Date.now(),
          isInterim: true
        }

        this.deps.emitter.emit('draft-stt-result', draftTranslationResult)
      })
      .catch((err) => {
        log.warn('Draft STT error (non-fatal):', err instanceof Error ? err.message : err)
      })
  }

  /**
   * Run speaker diarization in parallel with primary STT (#549).
   * Fire-and-forget — errors are logged but do not affect primary pipeline.
   * The result labels only the segment whose audio it analyzed.
   */
  private runDiarization(
    diarizer: SpeakerDiarizer,
    audioBuffer: Float32Array,
    sampleRate: number,
    segmentId: string
  ): void {
    const t0 = performance.now()
    diarizer.processAudio(audioBuffer, sampleRate)
      .then((result) => {
        const diarizeMs = (performance.now() - t0).toFixed(0)
        if (!result) {
          log.info(`Diarization: ${diarizeMs}ms → (no speaker)`)
          return
        }
        log.info(`Diarization: ${diarizeMs}ms → ${result.speakerLabel} (confidence: ${result.confidence.toFixed(2)})`)
        this.lastDiarization = { segmentId, result }
      })
      .catch((err) => {
        log.warn('Diarization error (non-fatal):', err instanceof Error ? err.message : err)
      })
  }

  /**
   * Run clause-level overlap translation when new confirmed text arrives (#615).
   *
   * Detects a clause boundary in the confirmed text and translates up to that
   * boundary immediately (fire-and-forget), without waiting for the debounce timer.
   * This overlaps translation with the next STT chunk, reducing end-to-end latency.
   *
   * Uses SSBD when a previous clause translation exists to avoid re-translating
   * the already-translated prefix.
   */
  private runClauseTranslation(
    segmentId: string,
    confirmedText: string,
    fullSourceText: string,
    sourceLang: Language,
    targetLang: Language
  ): void {
    const translator = this.deps.getTranslator()
    if (!translator || !confirmedText.trim()) return

    // Skip if already translating a clause or nothing new to translate
    if (this.clauseTranslationInFlight) return
    if (confirmedText === this.clauseTranslatedPrefix) return

    // Detect clause boundary in confirmed text
    const boundary = detectClauseBoundary(confirmedText, sourceLang)
    if (!boundary) return

    const textToTranslate = boundary.stablePrefix

    // Skip if this boundary was already translated
    if (textToTranslate === this.clauseTranslatedPrefix) return

    this.clauseTranslationInFlight = true

    const gen = this.deps.getGeneration?.()
    const glossaryEntries = this.deps.getGlossary()
    const glossary = glossaryEntries.length > 0 ? glossaryEntries : undefined
    const ctx = this.deps.contextBuffer.getContext(glossary)

    const t0 = performance.now()

    // Use SSBD if we have a previous clause translation to build on (#607)
    const translatePromise = (translator.translateSSBD && this.clauseTranslation)
      ? translator.translateSSBD(
          textToTranslate,
          this.clauseTranslation,
          sourceLang,
          targetLang,
          ctx
        ).catch((ssbdErr) => {
          log.warn('SSBD clause translation failed, falling back:', ssbdErr)
          return translator.translate(textToTranslate, sourceLang, targetLang, ctx)
        })
      : translator.translate(textToTranslate, sourceLang, targetLang, ctx)

    translatePromise.then((translated) => {
      const clauseMs = (performance.now() - t0).toFixed(0)
      log.info(`Clause translation: ${clauseMs}ms → ${translated.length} chars (input ${textToTranslate.length} chars)`)

      if (!this.mayEmitInterim(segmentId, gen)) return

      this.clauseTranslatedPrefix = textToTranslate
      this.clauseTranslation = translated
      this.lastTranslatedConfirmed = translated

      const clauseResult: TranslationResult = {
        segmentId,
        sourceText: fullSourceText,
        translatedText: translated,
        sourceLanguage: sourceLang,
        targetLanguage: targetLang,
        timestamp: Date.now(),
        isInterim: true
      }
      this.deps.emitter.emit('interim-result', clauseResult)
    }).catch((err) => {
      log.warn('Clause translation error (non-fatal):', err instanceof Error ? err.message : err)
    }).finally(() => {
      if (this.currentSegmentId === segmentId) this.clauseTranslationInFlight = false
    })
  }
}
