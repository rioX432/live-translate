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
    'thank you',
    'thanks for watching',
    'subscribe',
    'like and subscribe',
    'see you next time',
    'bye bye',
    'goodbye',
    'the end',
    'you',
    'ご視聴ありがとうございました',
    'ご覧いただきありがとうございました',
    'おやすみなさい',
    'チャンネル登録',
    'ではまた',
    'それでは',
    'よろしくお願いします',
    'お疲れ様でした',
    'お疲れ様です',
    'ありがとうございます',
    'ありがとうございました',
    'お願いします',
    'お元気で'
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

  // Filter single-kana or nonsensical short Japanese fragments (common STT garbage)
  // These are typically misheard syllables that produce hallucinations in OPUS-MT
  if (isGarbageJapanese(trimmed)) {
    console.debug(`[whisper-filter] Filtered garbage Japanese: "${trimmed}"`)
    return null
  }

  // Filter text that is mostly non-linguistic characters
  if (isMostlyNonLinguistic(trimmed)) {
    console.debug(`[whisper-filter] Filtered non-linguistic: "${trimmed}"`)
    return null
  }

  return trimmed
}

/**
 * Detects short, likely-garbage Japanese text from STT errors.
 * Patterns: isolated kana fragments, single kanji with particles, etc.
 */
function isGarbageJapanese(text: string): boolean {
  // Only apply to short text (up to ~6 chars) that is Japanese
  if (text.length > 8) return false
  const hasJapanese = /[\u3040-\u30FF\u4E00-\u9FFF]/.test(text)
  if (!hasJapanese) return false

  // Common standalone Japanese words that are valid even when short
  const commonWords = [
    'はい', 'いいえ', 'うん', 'ええ', 'そう', 'まあ', 'ねえ',
    'おはよう', 'すみません', 'ごめん', 'どうも', 'なるほど',
    'よし', 'えっと', 'あのう', 'まじ', 'やば', 'うそ', 'へえ',
    'ほら', 'さあ', 'もう', 'ねえ', 'だめ', 'いや', 'おい'
  ]
  if (commonWords.includes(text)) return false

  // Pure hiragana/katakana text ≤ 4 chars is likely a STT fragment
  // (real speech rarely produces isolated 1-4 kana without kanji or longer phrases)
  const pureKana = /^[\u3040-\u30FF\u3000-\u303F\s]+$/.test(text)
  if (pureKana && text.replace(/\s/g, '').length <= 4) return true

  // Mixed but very short (≤ 3 chars) with unusual character combinations
  // e.g., "おやかだ", "親もかへえ" — these are too short to be meaningful sentences
  if (text.length <= 5) {
    // Check if it contains archaic/uncommon kana combinations
    // Heuristic: if the text has no common particles/endings in a grammatical position, suspect garbage
    const commonEndings = /[。？！ます。です。した。って。ない。ある。いる。する。なる。れる。ている]$/
    const commonPatterns = /^(これ|それ|あれ|この|その|あの|ここ|そこ|あそこ|今|私|僕|俺|彼|彼女)/
    if (!commonEndings.test(text) && !commonPatterns.test(text)) {
      // Very short Japanese without recognizable grammar — likely garbage
      // (common standalone words already excluded above)
      return true
    }
  }

  return false
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
