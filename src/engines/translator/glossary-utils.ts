import type { GlossaryEntry } from '../types'

/**
 * Apply glossary term replacements to input text.
 * Each glossary entry's source term is replaced with its target term.
 * Skips entries with empty/whitespace-only source terms.
 */
export function applyGlossary(input: string, glossary: GlossaryEntry[] | undefined): string {
  if (!glossary?.length) return input

  let result = input
  for (const entry of glossary) {
    if (entry.source?.trim() && result.includes(entry.source)) {
      result = result.replaceAll(entry.source, entry.target)
    }
  }
  return result
}

/**
 * Format glossary entries as a prompt section for LLM-based translators.
 * Returns an empty string if glossary is empty or undefined.
 */
export function formatGlossaryPrompt(glossary: GlossaryEntry[] | undefined): string {
  if (!glossary || glossary.length === 0) return ''

  const entries = glossary
    .filter((g) => g.source && g.target)
    .map((g) => `  "${g.source}" → "${g.target}"`)
    .join('\n')
  if (!entries) return ''

  return `Use these fixed translations for specific terms:\n${entries}`
}
