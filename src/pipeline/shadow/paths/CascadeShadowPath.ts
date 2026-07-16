/**
 * CascadeShadowPath (#730) — measures the Local-first cascade (STT → MT) as one
 * shadow path, so it can be compared against the speech-native e2e paths.
 *
 * Each segment is processed in isolation: no ContextBuffer, no TranslationCache,
 * no glossary. Those production layers help quality but would make latency depend
 * on the segment's neighbours, and a cache hit would record a translation the
 * engine never actually performed.
 */

import type { Language, STTEngine, TranslatorEngine } from '../../../engines/types'
import type { PathSampleResult, ShadowCostModel, ShadowPath, ShadowPathKind } from '../types'

export interface CascadeShadowPathOptions {
  id?: string
  stt: STTEngine
  translator: TranslatorEngine
  /**
   * True if the translator routes through the shared node-llama-cpp UtilityProcess
   * pool (HY-MT1.5 / Hunyuan-MT / LFM2). Such paths contend for a single worker and
   * are gated by the runner's global local-LLM semaphore.
   */
  usesLocalLlm?: boolean
  cost?: ShadowCostModel
  /**
   * Fallback source language when the STT engine reports one outside JA/EN — e.g.
   * a JA-only engine mislabelling English audio. Defaults to 'ja'.
   */
  defaultSourceLanguage?: Language
}

/** JA⇄EN only: the target is always the other side of the pair (Core Value ③). */
function counterpart(language: Language): Language {
  return language === 'ja' ? 'en' : 'ja'
}

export class CascadeShadowPath implements ShadowPath {
  readonly id: string
  readonly kind: ShadowPathKind = 'cascade'
  readonly usesLocalLlm: boolean
  readonly isOffline: boolean
  readonly cost: ShadowCostModel

  private readonly stt: STTEngine
  private readonly translator: TranslatorEngine
  private readonly defaultSourceLanguage: Language

  constructor(options: CascadeShadowPathOptions) {
    this.id = options.id ?? `cascade:${options.stt.id}+${options.translator.id}`
    this.stt = options.stt
    this.translator = options.translator
    this.usesLocalLlm = options.usesLocalLlm ?? false
    // The cascade is only offline if BOTH stages are — a cloud MT stage sends the
    // transcript off-device regardless of where the STT ran.
    this.isOffline = options.stt.isOffline && options.translator.isOffline
    this.cost = options.cost ?? {}
    this.defaultSourceLanguage = options.defaultSourceLanguage ?? 'ja'
  }

  async process(
    audio: Float32Array,
    sampleRate: number,
    signal: AbortSignal
  ): Promise<PathSampleResult> {
    signal.throwIfAborted()
    const startedAt = performance.now()

    const stt = await this.stt.processAudio(audio, sampleRate)
    signal.throwIfAborted()
    // Silence / no-speech. Recorded as a zero-cost empty sample rather than an
    // error: the path behaved correctly, there was just nothing to translate.
    if (!stt || !stt.text.trim()) {
      return { sourceText: '', translatedText: '', firstSubtitleMs: null, revisionCount: 0 }
    }

    const from = stt.language === 'ja' || stt.language === 'en' ? stt.language : this.defaultSourceLanguage
    const translatedText = await this.translator.translate(stt.text, from, counterpart(from))
    signal.throwIfAborted()

    return {
      sourceText: stt.text,
      translatedText,
      // A batch cascade emits no interim: its first subtitle IS its final one, so
      // time-to-final is the honest first-subtitle latency. Recording null instead
      // would leave the baseline path without the very metric this harness exists
      // to compare. revisionCount 0 marks it as never-revised.
      firstSubtitleMs: performance.now() - startedAt,
      revisionCount: 0
    }
  }
}
