/**
 * GER (Generative Error Correction) processor for async STT post-processing (#409).
 *
 * Design:
 *   STT result → Translation (immediate, uncorrected) → Display
 *            ↘ GER (async, background) → Re-translate if changed → Update display
 *
 * GER runs in the shared SLM UtilityProcess (worker-pool.ts → slm-worker.ts).
 * It is selective: only triggers when STT confidence is below a threshold,
 * and only corrects proper nouns, numbers, units, and glossary terms.
 *
 * This feature is experimental and disabled by default.
 */

import type { EventEmitter } from 'events'
import type {
  Language,
  GlossaryEntry,
  TranslatorEngine,
  TranslationResult
} from '../engines/types'
import {
  GER_CONFIDENCE_THRESHOLD,
  GER_TIMEOUT_MS,
  GER_MIN_TEXT_LENGTH
} from '../engines/constants'
import { workerPool } from '../main/worker-pool'
import { createLogger } from '../main/logger'

const log = createLogger('pipeline:ger')

export interface GERDeps {
  readonly emitter: EventEmitter
  getTranslator(): TranslatorEngine | null
  getGlossary(): GlossaryEntry[]
}

/**
 * Async GER post-correction processor.
 * Call `maybeCorrect()` after STT produces a result — it runs in the background
 * and emits a 'ger-corrected' event if the corrected text differs.
 */
export class GERProcessor {
  private enabled = false
  private deps: GERDeps
  /** Track in-flight corrections to avoid duplicate work */
  private pendingTimestamp: number | null = null
  /** Last known translation for SSBD re-translation draft */
  private lastTranslation: string | null = null

  constructor(deps: GERDeps) {
    this.deps = deps
  }

  /** Enable or disable GER post-correction */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    log.info(`GER ${enabled ? 'enabled' : 'disabled'}`)
  }

  get isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Attempt async GER correction on the given STT result.
   * Returns immediately (fire-and-forget). If correction succeeds and
   * the text differs, re-translates and emits 'ger-corrected' event.
   *
   * @param sttText - Raw STT text
   * @param confidence - STT confidence (0.0–1.0), undefined means unknown
   * @param language - Detected source language
   * @param targetLanguage - Translation target language
   * @param timestamp - Original result timestamp for deduplication
   * @param previousTranslation - Previous translation output for SSBD re-translation draft
   */
  maybeCorrect(
    sttText: string,
    confidence: number | undefined,
    language: Language,
    targetLanguage: Language,
    timestamp: number,
    previousTranslation?: string
  ): void {
    if (!this.enabled) return

    // Skip if text is too short to meaningfully correct
    if (sttText.length < GER_MIN_TEXT_LENGTH) return

    // Skip if confidence is above threshold (STT is confident enough)
    if (confidence !== undefined && confidence >= GER_CONFIDENCE_THRESHOLD) {
      log.info(`GER skipped: confidence ${confidence.toFixed(2)} >= ${GER_CONFIDENCE_THRESHOLD}`)
      return
    }

    // Skip if worker is not alive (no SLM model loaded)
    if (!workerPool.isAlive) {
      log.info('GER skipped: SLM worker not running')
      return
    }

    // Skip if another correction is already in flight
    if (this.pendingTimestamp !== null) {
      log.info('GER skipped: correction already in flight')
      return
    }

    this.pendingTimestamp = timestamp
    this.lastTranslation = previousTranslation ?? null
    this.runCorrection(sttText, language, targetLanguage, timestamp).catch((err) => {
      log.warn('GER correction failed:', err)
    }).finally(() => {
      if (this.pendingTimestamp === timestamp) {
        this.pendingTimestamp = null
      }
    })
  }

  /** Reset state (e.g., on pipeline stop) */
  reset(): void {
    this.pendingTimestamp = null
    this.lastTranslation = null
  }

  private async runCorrection(
    sttText: string,
    language: Language,
    targetLanguage: Language,
    timestamp: number
  ): Promise<void> {
    const t0 = performance.now()

    const glossaryEntries = this.deps.getGlossary()
    const glossary = glossaryEntries.length > 0
      ? glossaryEntries.map((g) => ({ source: g.source, target: g.target }))
      : undefined

    // Send GER request to the SLM worker with a timeout race
    const correctedText = await Promise.race([
      workerPool.sendRequest(
        {
          type: 'ger-correct',
          text: sttText,
          language,
          glossary
        },
        'ger-correct'
      ),
      new Promise<string>((_resolve, reject) =>
        setTimeout(() => reject(new Error('GER timed out')), GER_TIMEOUT_MS)
      )
    ])

    const gerMs = performance.now() - t0
    log.info(`GER: ${gerMs.toFixed(0)}ms "${sttText}" → "${correctedText}"`)

    // Only proceed if the correction actually changed the text
    const trimmedOriginal = sttText.trim()
    const trimmedCorrected = correctedText.trim()
    if (!trimmedCorrected || trimmedCorrected === trimmedOriginal) {
      log.info('GER: no change, skipping re-translation')
      return
    }

    // Re-translate the corrected text, using SSBD if available for faster re-translation.
    // Since GER only makes small corrections, most of the previous translation remains valid.
    const translator = this.deps.getTranslator()
    if (!translator) {
      log.warn('GER: no translator available for re-translation')
      return
    }

    let translatedText: string
    if (translator.translateSSBD && this.lastTranslation) {
      try {
        translatedText = await translator.translateSSBD(
          trimmedCorrected,
          this.lastTranslation,
          language,
          targetLanguage
        )
        log.info('GER: used SSBD for re-translation')
      } catch (ssbdErr) {
        log.warn('GER: SSBD failed, falling back to regular translate:', ssbdErr)
        translatedText = await translator.translate(trimmedCorrected, language, targetLanguage)
      }
    } else {
      translatedText = await translator.translate(
        trimmedCorrected,
        language,
        targetLanguage
      )
    }

    const result: TranslationResult = {
      sourceText: trimmedCorrected,
      translatedText,
      sourceLanguage: language,
      targetLanguage: targetLanguage,
      timestamp,
      isInterim: false,
      translationStage: 'ger-corrected'
    }

    log.info(`GER corrected: "${trimmedOriginal}" → "${trimmedCorrected}" → "${translatedText}"`)
    this.deps.emitter.emit('ger-corrected', result)
  }
}
