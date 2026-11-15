import { LANG_NAMES_EN } from '../language-names'
import type { GlossaryEntry } from '../types'

export interface HyMt2PromptContext {
  previousSegments?: Array<{ source: string; translated: string }>
  glossary?: GlossaryEntry[]
}

/**
 * Greedy decoding instead of the model card's sampling (temperature 0.7, top_p 0.6,
 * top_k 20): the same utterance must give the same subtitle on every run, so
 * re-translating a segment never flickers and results can be compared across
 * runs. node-llama-cpp picks the most likely token at temperature 0 and ignores
 * the seed, top-k and top-p
 * (https://node-llama-cpp.withcat.ai/api/type-aliases/LLamaChatPromptOptions).
 * The card's repetition penalty is kept; it guards greedy decoding against loops.
 */
export const HY_MT2_INFERENCE_PARAMS = {
  temperature: 0,
  maxTokens: 512,
  repeatPenalty: { penalty: 1.05 }
} as const

/**
 * Most recent source sentences passed as background. Older ones rarely change
 * how the current sentence is translated and only add prompt tokens.
 */
const MAX_BACKGROUND_SEGMENTS = 2

/**
 * Build the Hy-MT2 user message from the official prompt templates
 * (https://huggingface.co/tencent/Hy-MT2-1.8B, "Prompt Templates"). Non-Chinese
 * pairs use the English templates with full language names, and the model card
 * recommends no system prompt.
 *
 * Background carries previous *source* sentences only. Feeding earlier
 * translations ("source → translation") made the model continue that pattern
 * and echo the previous sentence into the current one.
 */
export function buildHyMt2Prompt(
  text: string,
  to: string,
  context?: HyMt2PromptContext
): string {
  const targetLang = LANG_NAMES_EN[to] ?? to
  const terms = relevantTerms(text, context?.glossary)
  const background = (context?.previousSegments ?? [])
    .slice(-MAX_BACKGROUND_SEGMENTS)
    .map((s) => s.source.trim())
    .filter((s) => s.length > 0)

  const termBlock = terms.length > 0
    ? `Reference the following translations:\n${terms.map((t) => `${t.source} translates to ${t.target}`).join('\n')}\n\n`
    : ''

  if (background.length > 0) {
    return `${termBlock}[Background Information]\n${background.join('\n')}\n\n` +
      `Please translate the following text into ${targetLang}, taking the provided background information into consideration.\n\n` +
      `[Source Text]\n${text}`
  }

  if (terms.length > 0) {
    return `${termBlock}Translate the following text into ${targetLang}. Note that you must ONLY output the translated result without any additional explanation:\n\n${text}`
  }

  return `Translate the following text into ${targetLang}. Note that you should only output the translated result without any additional explanation:\n\n${text}`
}

/** Only terms that occur in the utterance, so a long glossary does not crowd the prompt. */
function relevantTerms(text: string, glossary: GlossaryEntry[] | undefined): GlossaryEntry[] {
  if (!glossary?.length) return []
  return glossary.filter((g) => g.source?.trim() && g.target?.trim() && text.includes(g.source))
}
