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
import type { SpeakerTracker } from './SpeakerTracker'
import type { GERProcessor } from './GERProcessor'
import { createLogger } from '../main/logger'

const log = createLogger('pipeline:stream')

const MAX_STREAMING_LOCK_RESOLVERS = 50
const STREAMING_LOCK_TIMEOUT_MS = 10_000

export interface StreamingDeps {
  readonly emitter: EventEmitter
  readonly agreement: LocalAgreement
  readonly contextBuffer: ContextBuffer
  readonly speakerTracker: SpeakerTracker
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

      const speakerId = sttResult.speakerId ?? this.deps.speakerTracker.update(Date.now())
      const glossaryEntries = this.deps.getGlossary()
      const glossary = glossaryEntries.length > 0 ? glossaryEntries : undefined
      const translator = this.deps.getTranslator()

      let translatedText = ''
      const simulMt = this.deps.getSimulMtConfig()

      // SimulMT path: use incremental translation with Wait-k policy
      if (
        simulMt.enabled &&
        translator?.translateIncremental &&
        agreement.confirmedText.trim()
      ) {
        const wordCount = this.countWords(agreement.confirmedText, sttResult.language)
        if (wordCount >= simulMt.waitK) {
          translatedText = await translator.translateIncremental(
            agreement.confirmedText,
            this.simulMtPreviousOutput,
            sttResult.language,
            targetLang,
            this.deps.contextBuffer.getContext(glossary, speakerId)
          )
          this.simulMtPreviousOutput = translatedText
          this.lastTranslatedConfirmed = translatedText
        } else {
          translatedText = this.simulMtPreviousOutput || this.lastTranslatedConfirmed
        }
      } else if (agreement.newConfirmed && translator) {
        // Standard path: translate only when new confirmed text appears
        translatedText = await translator.translate(
          agreement.confirmedText,
          sttResult.language,
          targetLang,
          this.deps.contextBuffer.getContext(glossary, speakerId)
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

      const speakerId = sttResult.speakerId ?? this.deps.speakerTracker.update(Date.now())
      const glossaryEntries = this.deps.getGlossary()
      const glossary = glossaryEntries.length > 0 ? glossaryEntries : undefined
      const translator = this.deps.getTranslator()

      let translatedText = ''
      if (translator && agreement.confirmedText.trim()) {
        translatedText = await translator.translate(
          agreement.confirmedText,
          sttResult.language,
          targetLang,
          this.deps.contextBuffer.getContext(glossary, speakerId)
        )
        this.deps.contextBuffer.add(agreement.confirmedText, translatedText, speakerId)
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
        speakerId,
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
          result.timestamp,
          speakerId
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
