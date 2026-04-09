/**
 * Japanese clause boundary detector for Conversational SimulMT (#550).
 *
 * Detects clause boundaries in Japanese text using particle-based segmentation.
 * Japanese is an SOV language, so verbs come at the end of clauses. However,
 * particles (は/を/が/に/で/と/も/から/まで/より) reliably mark phrase boundaries
 * within clauses, enabling partial translation before the full clause arrives.
 *
 * The detector splits incoming text into translatable chunks at particle boundaries,
 * allowing the SimulMT pipeline to start translating before the speaker finishes.
 */

/** Clause boundary detection result */
export interface ClauseBoundary {
  /** Text confirmed up to a clause/phrase boundary — safe to translate */
  stablePrefix: string
  /** Remaining text after the last boundary — still accumulating */
  pendingSuffix: string
  /** Index of the boundary in the original text */
  boundaryIndex: number
}

/**
 * Japanese particles that mark phrase boundaries.
 * Listed in descending length to match multi-char particles first.
 *
 * Categories:
 * - Case particles: は(topic), を(object), が(subject), に(direction/target), で(location/means)
 * - Conjunctive: と(and/with/quotation), も(also), から(from/because), まで(until), より(than/from)
 * - Clause-ending: けど/けれど(but), ので(because), のに(although), ため(for/because)
 * - Conjunctions after te-form: て/で (te-form verb endings act as clause connectors)
 */
const JA_BOUNDARY_PARTICLES = [
  // Multi-char clause-ending particles (check first)
  'けれども',
  'けれど',
  'ために',
  'から',
  'まで',
  'より',
  'ので',
  'のに',
  'けど',
  'ため',
  // Single-char case/topic particles
  'は',
  'を',
  'が',
  'に',
  'で',
  'と',
  'も'
] as const

/**
 * Minimum characters before we consider a boundary.
 * For Japanese, a single kanji + particle is already a valid phrase (e.g. "猫が"),
 * so the minimum is 1. For whitespace-delimited languages, 3 chars minimum
 * to avoid splitting too early.
 */
const MIN_JA_PREFIX_LENGTH = 1
const MIN_WS_PREFIX_LENGTH = 3

/**
 * Detect the last clause boundary in Japanese text.
 *
 * Scans the text for particle-based phrase boundaries and returns
 * the split point. For non-Japanese text, falls back to whitespace
 * word boundary detection.
 *
 * @param text - Input text to analyze
 * @param language - Source language code
 * @returns Clause boundary result, or null if no boundary found
 */
export function detectClauseBoundary(
  text: string,
  language: string
): ClauseBoundary | null {
  if (!text) return null

  if (language === 'ja') {
    if (text.length < MIN_JA_PREFIX_LENGTH + 1) return null
    return detectJapaneseClauseBoundary(text)
  }

  if (text.length < MIN_WS_PREFIX_LENGTH + 1) return null
  // For non-Japanese (e.g. English), split at the last whitespace word boundary
  return detectWhitespaceBoundary(text)
}

/**
 * Detect clause boundaries in Japanese text using particle matching.
 * Finds the LAST particle boundary to maximize the translatable prefix.
 */
function detectJapaneseClauseBoundary(text: string): ClauseBoundary | null {
  let lastBoundaryEnd = -1

  for (const particle of JA_BOUNDARY_PARTICLES) {
    // Search for all occurrences of this particle
    let searchFrom = MIN_JA_PREFIX_LENGTH
    while (searchFrom < text.length) {
      const idx = text.indexOf(particle, searchFrom)
      if (idx === -1) break

      const endIdx = idx + particle.length

      // Validate: particle must not be at the very end (need pending suffix)
      // and must have meaningful content before it
      if (endIdx < text.length && idx >= MIN_JA_PREFIX_LENGTH) {
        // Skip false positives: particle followed by another particle
        // e.g. "には" should be treated as a compound, split after "は" not "に"
        // We handle this by preferring the latest boundary found
        if (endIdx > lastBoundaryEnd) {
          lastBoundaryEnd = endIdx
        }
      }

      searchFrom = idx + 1
    }
  }

  if (lastBoundaryEnd === -1) return null

  return {
    stablePrefix: text.slice(0, lastBoundaryEnd),
    pendingSuffix: text.slice(lastBoundaryEnd),
    boundaryIndex: lastBoundaryEnd
  }
}

/**
 * Detect word boundaries in whitespace-delimited languages (English, etc).
 * Finds the last whitespace boundary to maximize the translatable prefix.
 */
function detectWhitespaceBoundary(text: string): ClauseBoundary | null {
  // Find last space that leaves at least MIN_PREFIX_LENGTH chars before it
  // and at least 1 char after it (pending suffix must exist)
  const lastSpace = text.lastIndexOf(' ')

  if (lastSpace <= MIN_WS_PREFIX_LENGTH || lastSpace >= text.length - 1) {
    return null
  }

  return {
    stablePrefix: text.slice(0, lastSpace + 1),
    pendingSuffix: text.slice(lastSpace + 1),
    boundaryIndex: lastSpace + 1
  }
}

/**
 * Count translatable units in text based on language.
 * For Japanese: character count (no word boundaries).
 * For English and others: word count.
 */
export function countUnits(text: string, language: string): number {
  if (!text.trim()) return 0

  if (language === 'ja' || language === 'zh' || language === 'ko') {
    return text.replace(/\s/g, '').length
  }

  return text.trim().split(/\s+/).filter(Boolean).length
}
