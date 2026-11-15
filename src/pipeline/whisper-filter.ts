/**
 * Phrases Whisper produces from silence or noise because of its video-subtitle
 * training data. Only phrases nobody says on their own in a meeting belong here:
 * greetings and thanks such as 「よろしくお願いします」 or "Thank you." are real
 * meeting turns, and silence is rejected by the energy gate before STT instead
 * (see audio-energy.ts).
 */
const HALLUCINATION_PHRASES = [
  'thanks for watching',
  'subscribe',
  'like and subscribe',
  'the end',
  'you',
  'ご視聴ありがとうございました',
  'ご覧いただきありがとうございました',
  'チャンネル登録'
]

/**
 * Filters common Whisper hallucination patterns.
 * Returns null if the text is likely hallucinated, otherwise returns the cleaned text.
 * Logs only lengths: the text may be confidential meeting content.
 */
export function filterWhisperHallucination(text: string): string | null {
  const trimmed = text.trim()

  // Filter extremely short results (< 2 meaningful characters)
  if (trimmed.length < 2) return null

  const lower = trimmed.toLowerCase()
  for (const phrase of HALLUCINATION_PHRASES) {
    if (lower === phrase || lower === `${phrase}.` || lower === `${phrase}!`) {
      console.debug(`[whisper-filter] Filtered hallucination (${trimmed.length} chars)`)
      return null
    }
  }

  // Filter repetitive patterns (same word/phrase repeated 3+ times)
  if (hasRepetitivePattern(trimmed)) {
    console.debug(`[whisper-filter] Filtered repetitive (${trimmed.length} chars)`)
    return null
  }

  // Filter text that is only punctuation or special characters
  if (/^[\s.,!?…。、！？・\-—]+$/.test(trimmed)) return null

  // Filter text that is mostly non-linguistic characters
  if (isMostlyNonLinguistic(trimmed)) {
    console.debug(`[whisper-filter] Filtered non-linguistic (${trimmed.length} chars)`)
    return null
  }

  return trimmed
}

/**
 * Checks if text is mostly non-linguistic (symbols, random chars, etc.)
 */
function isMostlyNonLinguistic(text: string): boolean {
  if (text.length < 3) return false
  // Count meaningful characters: letters (any script), digits
  const meaningful = (text.match(/[\p{L}\p{N}]/gu) || []).length
  return meaningful / text.length < 0.4
}

/**
 * Detects repetitive patterns like "word word word" or "phrase. phrase. phrase."
 */
function hasRepetitivePattern(text: string): boolean {
  // Split by common delimiters
  const segments = text.split(/[.。!！?？,、\s]+/).filter((s) => s.length > 0)
  if (segments.length < 3) return false

  // Count occurrences of each segment
  const counts = new Map<string, number>()
  for (const seg of segments) {
    const key = seg.toLowerCase()
    counts.set(key, (counts.get(key) || 0) + 1)
  }

  // If any single segment makes up 60%+ of all segments, it's repetitive
  for (const count of counts.values()) {
    if (count >= 3 && count / segments.length >= 0.6) return true
  }

  return false
}
