/**
 * Filters common Whisper hallucination patterns.
 * Returns null if the text is likely hallucinated, otherwise returns the cleaned text.
 */
export function filterWhisperHallucination(text: string): string | null {
  const trimmed = text.trim()

  // Filter extremely short results (< 2 meaningful characters)
  if (trimmed.length < 2) return null

  // Filter common Whisper hallucination phrases
  const hallucinationPhrases = [
    // English
    'thank you',
    'thank you for watching',
    'thanks for watching',
    'thanks',
    'subscribe',
    'like and subscribe',
    'see you next time',
    'see you in the next',
    'see you later',
    'bye bye',
    'bye',
    'goodbye',
    'the end',
    'you',
    'okay',
    'alright',
    // Japanese
    'ご視聴ありがとうございました',
    'ご視聴ありがとうございます',
    'ありがとうございました',
    'おやすみなさい',
    'チャンネル登録',
    'チャンネル登録お願いします',
    'ではまた',
    'では',
    'また明日',
    'バイバイ',
    'さようなら',
    'お疲れ様でした'
  ]

  const lower = trimmed.toLowerCase()
  for (const phrase of hallucinationPhrases) {
    if (lower === phrase || lower === `${phrase}.` || lower === `${phrase}!`) {
      console.debug(`[whisper-filter] Filtered hallucination: "${trimmed}"`)
      return null
    }
  }

  // Filter repetitive patterns (same word/phrase repeated 3+ times)
  if (hasRepetitivePattern(trimmed)) {
    console.debug(`[whisper-filter] Filtered repetitive: "${trimmed}"`)
    return null
  }

  // Filter text that is only punctuation or special characters
  if (/^[\s.,!?…。、！？・\-—]+$/.test(trimmed)) return null

  return trimmed
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
