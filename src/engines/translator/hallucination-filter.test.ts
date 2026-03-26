import { describe, it, expect } from 'vitest'
import { isHallucination } from './hallucination-filter'

describe('isHallucination', () => {
  describe('length ratio', () => {
    it('rejects output 3x longer than short input (< 10 chars)', () => {
      // 4 chars input, 13 chars output = 3.25x
      expect(isHallucination('おやかだ', 'a'.repeat(13), 'ja', 'en')).toBe(true)
    })

    it('allows reasonable length output for short input', () => {
      expect(isHallucination('こんにちは', 'Hello', 'ja', 'en')).toBe(false)
    })

    it('allows longer output for longer input', () => {
      const input = '今日の会議は午後三時から始まります'
      const output = 'The meeting starts at 3pm today'
      expect(isHallucination(input, output, 'ja', 'en')).toBe(false)
    })
  })

  describe('script mismatch', () => {
    it('rejects CJK-heavy output for JA→EN translation', () => {
      expect(isHallucination('テスト', '漢字漢字漢字', 'ja', 'en')).toBe(true)
    })

    it('allows mostly-ASCII output for JA→EN', () => {
      expect(isHallucination('テスト', 'test', 'ja', 'en')).toBe(false)
    })

    it('rejects all-ASCII output for EN→JA', () => {
      expect(isHallucination('hello world', 'some random english', 'en', 'ja')).toBe(true)
    })

    it('allows CJK output for EN→JA', () => {
      expect(isHallucination('hello', 'こんにちは', 'en', 'ja')).toBe(false)
    })
  })

  describe('repetition detection', () => {
    it('rejects word-level repetition', () => {
      expect(isHallucination('テスト', 'word word word word word', 'ja', 'en')).toBe(true)
    })

    it('rejects substring repetition', () => {
      expect(isHallucination('テスト', 'abcabcabcabc', 'ja', 'en')).toBe(true)
    })

    it('allows normal text with some repeated words', () => {
      expect(isHallucination('彼は走って走った', 'He ran and ran', 'ja', 'en')).toBe(false)
    })
  })

  describe('excessive punctuation', () => {
    it('rejects output that is mostly punctuation', () => {
      expect(isHallucination('テスト', '...---...!!!', 'ja', 'en')).toBe(true)
    })

    it('allows normal text with some punctuation', () => {
      expect(isHallucination('元気ですか', 'How are you?', 'ja', 'en')).toBe(false)
    })
  })

  describe('real-world hallucination examples', () => {
    it('rejects nonsensical long output from short corrupt input', () => {
      // Short garbage input producing long output
      expect(isHallucination('おやかだ', 'The parent is also a child of the gods.', 'ja', 'en')).toBe(true)
    })

    it('returns false for empty output', () => {
      expect(isHallucination('テスト', '', 'ja', 'en')).toBe(false)
    })
  })
})
