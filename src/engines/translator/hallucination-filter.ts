import type { Language } from '../types'

// CJK Unicode ranges: Hiragana, Katakana, CJK Unified Ideographs, CJK Extension A/B, halfwidth katakana
const CJK_REGEX = /[\u3000-\u30FF\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF\uFF65-\uFF9F]/g
// ASCII letters (basic Latin)
const ASCII_LETTER_REGEX = /[A-Za-z]/g

/**
 * Detect whether OPUS-MT output is likely a hallucination.
 * Checks multiple heuristics and returns true if any fire.
 */
export function isHallucination(
  input: string,
  output: string,
  from: Language,
  to: Language
): boolean {
  if (!output.trim()) return false

  // 1. Length ratio check — tightened from 5x to 3x for short inputs
  if (hasExcessiveLengthRatio(input, output)) return true

  // 2. Character-class mismatch — output should match target language script
  if (hasScriptMismatch(output, to)) return true

  // 3. Repetition detection — hallucinated outputs often repeat phrases
  if (hasRepetition(output)) return true

  // 4. Excessive punctuation or special characters
  if (hasExcessivePunctuation(output)) return true

  return false
}

/**
 * Check if output length is disproportionately long relative to input.
 * Short inputs (< 10 chars) use a stricter 3x ratio.
 * Medium inputs (< 30 chars) use 4x. Longer inputs use 5x.
 */
function hasExcessiveLengthRatio(input: string, output: string): boolean {
  const inLen = input.length
  const outLen = output.length

  let maxRatio: number
  if (inLen < 10) {
    maxRatio = 3
  } else if (inLen < 30) {
    maxRatio = 4
  } else {
    maxRatio = 5
  }

  return outLen > inLen * maxRatio
}

/**
 * Check if the output contains unexpected script for the target language.
 * JA→EN: output should be mostly ASCII (allow small % of non-ASCII for names/loanwords)
 * EN→JA: output should contain CJK characters
 */
function hasScriptMismatch(output: string, targetLang: Language): boolean {
  const trimmed = output.trim()
  if (trimmed.length === 0) return false

  if (targetLang === 'en') {
    // For English output, at least 70% should be ASCII letters, digits, spaces, or common punctuation
    const asciiCount = (trimmed.match(/[\x20-\x7E]/g) || []).length
    const ratio = asciiCount / trimmed.length
    // If less than 60% ASCII, likely garbage
    return ratio < 0.6
  }

  if (targetLang === 'ja') {
    // For Japanese output, should contain at least some CJK characters
    const cjkCount = (trimmed.match(CJK_REGEX) || []).length
    // If no CJK at all in a non-trivial output, suspicious
    return trimmed.length > 3 && cjkCount === 0
  }

  return false
}

/**
 * Detect repetitive patterns in output — a common OPUS-MT hallucination symptom.
 * Looks for repeated n-grams (words or character sequences).
 */
function hasRepetition(output: string): boolean {
  const trimmed = output.trim()

  // Word-level repetition: split into words, check if any word repeats 4+ times
  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length >= 4) {
    const counts = new Map<string, number>()
    for (const w of words) {
      counts.set(w, (counts.get(w) || 0) + 1)
    }
    for (const [word, count] of counts) {
      // Skip very short words (articles, prepositions) — they naturally repeat
      if (word.length <= 2) continue
      if (count >= 4 && count / words.length >= 0.4) return true
    }
  }

  // Substring repetition: check if a substring (3-20 chars) repeats 3+ times consecutively
  for (let len = 3; len <= Math.min(20, Math.floor(trimmed.length / 3)); len++) {
    const pattern = trimmed.substring(0, len)
    let repeats = 0
    let pos = 0
    while (pos + len <= trimmed.length) {
      if (trimmed.substring(pos, pos + len) === pattern) {
        repeats++
        pos += len
      } else {
        break
      }
    }
    if (repeats >= 3) return true
  }

  return false
}

/**
 * Check if output is mostly punctuation/symbols — another hallucination indicator.
 */
function hasExcessivePunctuation(output: string): boolean {
  const trimmed = output.trim()
  if (trimmed.length < 3) return false

  // Count alphanumeric + CJK chars
  const meaningful =
    (trimmed.match(ASCII_LETTER_REGEX) || []).length +
    (trimmed.match(CJK_REGEX) || []).length +
    (trimmed.match(/\d/g) || []).length

  // If less than 30% meaningful characters, it's mostly symbols/punctuation
  return meaningful / trimmed.length < 0.3
}
