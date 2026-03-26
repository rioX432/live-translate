import type { TranslatorEngine, Language, TranslateContext, TranslationResult } from '../types'
import { createLogger } from '../../main/logger'

const log = createLogger('hybrid')

/**
 * Callback type for emitting draft translation results.
 * Called by HybridTranslator after the draft engine produces a result,
 * before the refine engine runs.
 */
export type OnDraftCallback = (draft: TranslationResult) => void

/**
 * Two-stage hybrid translator: fast OPUS-MT draft + LLM refinement (#235).
 *
 * Flow:
 *   1. Run draftEngine.translate() -> emit draft via onDraft callback
 *   2. Run refineEngine.translate() -> if different from draft, return refined
 *   3. If refined matches draft, return draft (skip replacement)
 *
 * Both engines are owned by this translator and disposed together.
 */
export class HybridTranslator implements TranslatorEngine {
  readonly id = 'hybrid'
  readonly name = 'Hybrid (OPUS-MT + LLM)'
  readonly isOffline = true

  private draftEngine: TranslatorEngine
  private refineEngine: TranslatorEngine
  private onDraft: OnDraftCallback | null = null

  constructor(draftEngine: TranslatorEngine, refineEngine: TranslatorEngine) {
    this.draftEngine = draftEngine
    this.refineEngine = refineEngine
  }

  /** Set the callback for draft result emission. Called by pipeline. */
  setOnDraft(callback: OnDraftCallback): void {
    this.onDraft = callback
  }

  async initialize(): Promise<void> {
    // Initialize both engines (draft first since it's faster to load)
    await this.draftEngine.initialize()
    await this.refineEngine.initialize()
  }

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text

    // Stage 1: Fast draft translation
    const draftText = await this.draftEngine.translate(text, from, to, context)

    // Emit draft result via callback so pipeline can forward it
    if (this.onDraft && draftText) {
      this.onDraft({
        sourceText: text,
        translatedText: draftText,
        sourceLanguage: from,
        targetLanguage: to,
        timestamp: Date.now(),
        translationStage: 'draft'
      })
    }

    // Stage 2: LLM refinement
    try {
      const refinedText = await this.refineEngine.translate(text, from, to, context)

      // Only return refined if it actually differs from draft (save visual churn)
      if (refinedText && refinedText !== draftText) {
        return refinedText
      }
    } catch (err) {
      // If refinement fails, fall back to draft silently
      log.warn('Refinement failed, using draft:', err)
    }

    return draftText
  }

  async dispose(): Promise<void> {
    // Dispose both engines safely
    try {
      await this.draftEngine.dispose()
    } catch (err) {
      log.warn('Error disposing draft engine:', err)
    }
    try {
      await this.refineEngine.dispose()
    } catch (err) {
      log.warn('Error disposing refine engine:', err)
    }
  }
}
