import type { EventEmitter } from 'events'
import type {
  TranslationResult,
  Language,
  GlossaryEntry,
  TranslatorEngine
} from '../engines/types'
import type { STTEngine } from '../engines/types'
import type { LocalAgreement } from './LocalAgreement'
import type { ContextBuffer } from './ContextBuffer'
import type { GERProcessor } from './GERProcessor'
import { createLogger } from '../main/logger'

const log = createLogger('pipeline:stream')

const MAX_STREAMING_LOCK_RESOLVERS = 50
const STREAMING_LOCK_TIMEOUT_MS = 10_000
/** Debounce delay before translating interim text (ms) */
const TRANSLATE_DEBOUNCE_MS = 1000

export interface StreamingDeps {
  readonly emitter: EventEmitter
  readonly agreement: LocalAgreement
  readonly contextBuffer: ContextBuffer
  getSTTEngine(): STTEngine | null
  getTranslator(): TranslatorEngine | null
  getGlossary(): GlossaryEntry[]
  getSimulMtConfig(): { enabled: boolean; waitK: number }
  resolveTargetLanguage(detectedLang: Language): Language
  /** Notify that processing count changed */
  incrementProcessing(): void
  decrementProcessing(): void
  /** GER processor for async STT post-correction */
  getGER?(): GERProcessor | null
  /** Draft STT engine for fast interim results (#536) */
  getDraftSTTEngine?(): STTEngine | null
}

/**
 * Handles streaming audio processing: processStreaming(), finalizeStreaming(),
 * and the streaming lock mechanism.
 * Extracted from TranslationPipeline to isolate streaming-specific logic.
 */
export class StreamingProcessor {
  private streamingLock = false
  private streamingLockResolvers: Array<() => void> = []

  // Streaming translation state
  lastTranslatedConfirmed = ''
  simulMtPreviousOutput = ''

  /** Debounced translation: timer and last source text for change detection */
  private translateDebounceTimer: ReturnType<typeof setTimeout> | null = null
  private lastSourceTextForTranslate = ''

  private deps: StreamingDeps

  constructor(deps: StreamingDeps) {
    this.deps = deps
  }

  get isLocked(): boolean {
    return this.streamingLock
  }

  /** Reset all streaming state */
  reset(): void {
    this.streamingLock = false
    for (const r of this.streamingLockResolvers) r()
    this.streamingLockResolvers = []
    this.lastTranslatedConfirmed = ''
    this.simulMtPreviousOutput = ''
    if (this.translateDebounceTimer) {
      clearTimeout(this.translateDebounceTimer)
      this.translateDebounceTimer = null
    }
    this.lastSourceTextForTranslate = ''
  }

  async processStreaming(
    audioBuffer: Float32Array,
    sampleRate: number
  ): Promise<TranslationResult | null> {
    const sttEngine = this.deps.getSTTEngine()
    if (!sttEngine) return null
    // Drop chunk if another streaming call is in-flight — acceptable because
    // the rolling buffer re-sends accumulated audio on the next interval (#103)
    if (this.streamingLock) return null

    this.deps.incrementProcessing()
    this.streamingLock = true
    try {
      // Fire draft STT in parallel for fast interim results (#536)
      const draftSttEngine = this.deps.getDraftSTTEngine?.()
      if (draftSttEngine) {
        this.runDraftStt(draftSttEngine, audioBuffer, sampleRate)
      }

      const t0 = performance.now()
      const sttResult = await sttEngine.processAudio(audioBuffer, sampleRate)
      const sttMs = (performance.now() - t0).toFixed(0)
      if (!sttResult || !sttResult.text.trim()) {
        log.info(`STT: ${sttMs}ms → (no result, ${(audioBuffer.length / sampleRate).toFixed(1)}s audio)`)
        // Reset agreement on silence to prevent stale state accumulation (#75)
        this.deps.agreement.reset()
        this.lastTranslatedConfirmed = ''
        this.simulMtPreviousOutput = ''
        return null
      }
      log.info(`STT: ${sttMs}ms → "${sttResult.text}" [${sttResult.language}]`)

      const agreement = this.deps.agreement.update(sttResult.text)
      const targetLang = this.deps.resolveTargetLanguage(sttResult.language)

      const fullSourceText = agreement.confirmedText + agreement.interimText

      // Debounced translation: schedule translation when source text stabilizes for 1s.
      // This avoids translating on every interim update while still translating
      // during continuous speech (at natural pauses / breathing points).
      if (fullSourceText !== this.lastSourceTextForTranslate) {
        this.lastSourceTextForTranslate = fullSourceText
        if (this.translateDebounceTimer) clearTimeout(this.translateDebounceTimer)
        this.translateDebounceTimer = setTimeout(() => {
          this.translateDebounceTimer = null
          const translator = this.deps.getTranslator()
          if (!translator || !fullSourceText.trim()) return
          const glossaryEntries = this.deps.getGlossary()
          const glossary = glossaryEntries.length > 0 ? glossaryEntries : undefined
          translator.translate(
            fullSourceText,
            sttResult.language,
            targetLang,
            this.deps.contextBuffer.getContext(glossary)
          ).then((translated) => {
            this.lastTranslatedConfirmed = translated
            const debouncedResult: TranslationResult = {
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

      const interimResult: TranslationResult = {
        sourceText: fullSourceText,
        confirmedText: agreement.confirmedText,
        interimText: agreement.interimText,
        translatedText: this.lastTranslatedConfirmed,
        sourceLanguage: sttResult.language,
        targetLanguage: targetLang,
        timestamp: Date.now(),
        isInterim: true
      }

      this.deps.emitter.emit('interim-result', interimResult)
      return interimResult
    } catch (err) {
      this.deps.emitter.emit('error', err instanceof Error ? err : new Error(String(err)))
      return null
    } finally {
      this.streamingLock = false
      this.deps.decrementProcessing()
      for (const r of this.streamingLockResolvers) r()
      this.streamingLockResolvers = []
    }
  }

  async finalizeStreaming(
    audioChunk: Float32Array,
    sampleRate: number
  ): Promise<TranslationResult | null> {
    const sttEngine = this.deps.getSTTEngine()
    if (!sttEngine) return null

    if (this.streamingLock) {
      await this.waitForStreamingLock()
    }
    this.deps.incrementProcessing()
    this.streamingLock = true

    try {
      const sttResult = await sttEngine.processAudio(audioChunk, sampleRate)
      if (!sttResult || !sttResult.text.trim()) {
        this.deps.agreement.reset()
        this.lastTranslatedConfirmed = ''
        this.simulMtPreviousOutput = ''
        return null
      }

      const agreement = this.deps.agreement.finalize(sttResult.text)
      const targetLang = this.deps.resolveTargetLanguage(sttResult.language)

      const glossaryEntries = this.deps.getGlossary()
      const glossary = glossaryEntries.length > 0 ? glossaryEntries : undefined
      const translator = this.deps.getTranslator()

      let translatedText = ''
      if (translator && agreement.confirmedText.trim()) {
        translatedText = await translator.translate(
          agreement.confirmedText,
          sttResult.language,
          targetLang,
          this.deps.contextBuffer.getContext(glossary)
        )
        this.deps.contextBuffer.add(agreement.confirmedText, translatedText)
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
        confidence: sttResult.confidence
      }

      this.deps.emitter.emit('result', result)

      // Fire-and-forget GER correction on finalized result (async, non-blocking)
      const ger = this.deps.getGER?.()
      if (ger) {
        ger.maybeCorrect(
          agreement.confirmedText,
          sttResult.confidence,
          sttResult.language,
          targetLang,
          result.timestamp
        )
      }

      return result
    } catch (err) {
      this.deps.agreement.reset()
      this.lastTranslatedConfirmed = ''
      this.deps.emitter.emit('error', err instanceof Error ? err : new Error(String(err)))
      return null
    } finally {
      this.streamingLock = false
      this.deps.decrementProcessing()
      for (const r of this.streamingLockResolvers) r()
      this.streamingLockResolvers = []
    }
  }

  /**
   * Run draft STT (Moonshine Tiny JA) in parallel with primary STT.
   * Emits result as 'draft-stt-result' immediately for fast interim display (#536).
   * Fire-and-forget — errors are logged but do not affect primary pipeline.
   */
  private runDraftStt(draftEngine: STTEngine, audioBuffer: Float32Array, sampleRate: number): void {
    const t0 = performance.now()
    draftEngine.processAudio(audioBuffer, sampleRate)
      .then((draftResult) => {
        const draftMs = (performance.now() - t0).toFixed(0)
        if (!draftResult || !draftResult.text.trim()) {
          log.info(`Draft STT: ${draftMs}ms → (no result)`)
          return
        }
        log.info(`Draft STT: ${draftMs}ms → "${draftResult.text}" [${draftResult.language}]`)

        const targetLang = this.deps.resolveTargetLanguage(draftResult.language)

        const draftTranslationResult: TranslationResult = {
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
   * Wait for the streaming lock to be released with a timeout and backpressure cap.
   * If more than MAX_STREAMING_LOCK_RESOLVERS are already waiting, the oldest
   * resolvers are auto-resolved to prevent unbounded growth (#292, #431).
   */
  private waitForStreamingLock(): Promise<void> {
    return new Promise<void>((resolve) => {
      // Evict oldest waiters when the queue is full to prevent unbounded growth (#431)
      if (this.streamingLockResolvers.length >= MAX_STREAMING_LOCK_RESOLVERS) {
        const evictCount = this.streamingLockResolvers.length - MAX_STREAMING_LOCK_RESOLVERS + 1
        log.warn(
          `streamingLock resolver queue overflow: evicting ${evictCount} oldest resolver(s) (queue size: ${this.streamingLockResolvers.length})`
        )
        for (let i = 0; i < evictCount; i++) {
          const oldest = this.streamingLockResolvers.shift()
          if (oldest) oldest()
        }
      }

      // Auto-resolve after timeout so callers never hang indefinitely
      const timer = setTimeout(() => {
        const idx = this.streamingLockResolvers.indexOf(resolve)
        if (idx !== -1) {
          this.streamingLockResolvers.splice(idx, 1)
          log.warn('streamingLock wait timed out')
          resolve()
        }
      }, STREAMING_LOCK_TIMEOUT_MS)

      this.streamingLockResolvers.push(() => {
        clearTimeout(timer)
        resolve()
      })
    })
  }

  /**
   * Count words in text. For CJK text (Japanese/Chinese/Korean), count characters
   * since there are no space-delimited word boundaries.
   */
  private countWords(text: string, language: Language): number {
    if (language === 'ja' || language === 'zh') {
      return text.replace(/\s/g, '').length
    }
    if (language === 'ko') {
      return text.replace(/\s/g, '').length
    }
    return text.trim().split(/\s+/).filter(Boolean).length
  }
}
