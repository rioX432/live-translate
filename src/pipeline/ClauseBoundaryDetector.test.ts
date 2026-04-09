import { describe, it, expect } from 'vitest'
import { detectClauseBoundary, countUnits } from './ClauseBoundaryDetector'

describe('ClauseBoundaryDetector', () => {
  describe('detectClauseBoundary (Japanese)', () => {
    it('detects latest particle boundary', () => {
      // "私は学生です" — は at 1, で at 4 (in です)
      // Latest boundary is after で
      const result = detectClauseBoundary('私は学生です', 'ja')
      expect(result).not.toBeNull()
      expect(result!.stablePrefix).toBe('私は学生で')
      expect(result!.pendingSuffix).toBe('す')
    })

    it('detects particle は when it is the only boundary', () => {
      const result = detectClauseBoundary('私は元気', 'ja')
      expect(result).not.toBeNull()
      expect(result!.stablePrefix).toBe('私は')
      expect(result!.pendingSuffix).toBe('元気')
    })

    it('detects particle を boundary', () => {
      const result = detectClauseBoundary('本を読む', 'ja')
      expect(result).not.toBeNull()
      expect(result!.stablePrefix).toBe('本を')
      expect(result!.pendingSuffix).toBe('読む')
    })

    it('detects particle が boundary', () => {
      const result = detectClauseBoundary('猫が寝ている', 'ja')
      expect(result).not.toBeNull()
      expect(result!.stablePrefix).toBe('猫が')
      expect(result!.pendingSuffix).toBe('寝ている')
    })

    it('detects multi-char particle から boundary', () => {
      const result = detectClauseBoundary('東京から大阪まで行く', 'ja')
      expect(result).not.toBeNull()
      // Should find the latest boundary (まで)
      expect(result!.stablePrefix).toBe('東京から大阪まで')
      expect(result!.pendingSuffix).toBe('行く')
    })

    it('detects clause-ending particle ので', () => {
      const result = detectClauseBoundary('雨なので傘を持つ', 'ja')
      expect(result).not.toBeNull()
      // Latest boundary: を after 傘
      expect(result!.pendingSuffix).toBe('持つ')
    })

    it('returns null for text too short', () => {
      expect(detectClauseBoundary('あ', 'ja')).toBeNull()
      expect(detectClauseBoundary('ab', 'ja')).toBeNull()
    })

    it('returns null when no boundary found', () => {
      // No particles in this text
      expect(detectClauseBoundary('あいうえお', 'ja')).toBeNull()
    })

    it('returns null when particle is at the end (no pending suffix)', () => {
      // Particle at end means no suffix to accumulate
      expect(detectClauseBoundary('猫が', 'ja')).toBeNull()
    })

    it('finds latest boundary in complex sentence', () => {
      const result = detectClauseBoundary('私は東京で友達と会う', 'ja')
      expect(result).not.toBeNull()
      // Latest boundary should be after と (友達と)
      expect(result!.stablePrefix).toBe('私は東京で友達と')
      expect(result!.pendingSuffix).toBe('会う')
    })

    it('handles empty text', () => {
      expect(detectClauseBoundary('', 'ja')).toBeNull()
    })
  })

  describe('detectClauseBoundary (English)', () => {
    it('detects whitespace word boundary', () => {
      const result = detectClauseBoundary('The cat sat on the mat', 'en')
      expect(result).not.toBeNull()
      // Last space before "mat"
      expect(result!.stablePrefix).toBe('The cat sat on the ')
      expect(result!.pendingSuffix).toBe('mat')
    })

    it('returns null for single word', () => {
      expect(detectClauseBoundary('Hello', 'en')).toBeNull()
    })

    it('returns null for very short text', () => {
      expect(detectClauseBoundary('Hi', 'en')).toBeNull()
    })

    it('handles text with only leading space', () => {
      // Space too early (before MIN_WS_PREFIX_LENGTH)
      expect(detectClauseBoundary('a b', 'en')).toBeNull()
    })

    it('returns null when text is too short', () => {
      expect(detectClauseBoundary('abc', 'en')).toBeNull()
    })
  })

  describe('countUnits', () => {
    it('counts characters for Japanese', () => {
      expect(countUnits('猫が寝ている', 'ja')).toBe(6)
    })

    it('counts characters for Chinese', () => {
      expect(countUnits('你好世界', 'zh')).toBe(4)
    })

    it('counts words for English', () => {
      expect(countUnits('The cat sat', 'en')).toBe(3)
    })

    it('returns 0 for empty text', () => {
      expect(countUnits('', 'ja')).toBe(0)
      expect(countUnits('  ', 'en')).toBe(0)
    })

    it('ignores whitespace in CJK counting', () => {
      expect(countUnits('猫 が', 'ja')).toBe(2)
    })
  })
})
