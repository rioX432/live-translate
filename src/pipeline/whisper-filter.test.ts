import { describe, it, expect } from 'vitest'
import { filterWhisperHallucination } from './whisper-filter'

describe('filterWhisperHallucination', () => {
  it('returns null for short text', () => {
    expect(filterWhisperHallucination('a')).toBeNull()
    expect(filterWhisperHallucination(' ')).toBeNull()
  })

  it('filters known hallucination phrases', () => {
    expect(filterWhisperHallucination('Thank you')).toBeNull()
    expect(filterWhisperHallucination('thanks for watching')).toBeNull()
    expect(filterWhisperHallucination('ご視聴ありがとうございました')).toBeNull()
    expect(filterWhisperHallucination('subscribe')).toBeNull()
  })

  it('filters with trailing punctuation', () => {
    expect(filterWhisperHallucination('Thank you.')).toBeNull()
    expect(filterWhisperHallucination('Thank you!')).toBeNull()
  })

  it('filters repetitive patterns', () => {
    expect(filterWhisperHallucination('hello hello hello hello')).toBeNull()
    expect(filterWhisperHallucination('test. test. test.')).toBeNull()
  })

  it('filters punctuation-only text', () => {
    expect(filterWhisperHallucination('...')).toBeNull()
    expect(filterWhisperHallucination('。。。')).toBeNull()
    expect(filterWhisperHallucination('  ---  ')).toBeNull()
  })

  it('filters garbage Japanese fragments', () => {
    // Short nonsensical kana (common STT errors)
    expect(filterWhisperHallucination('おやかだ')).toBeNull()
    expect(filterWhisperHallucination('かへえ')).toBeNull()
    expect(filterWhisperHallucination('ぱぴ')).toBeNull()
    // Single kana
    expect(filterWhisperHallucination('あ')).toBeNull()
  })

  it('passes valid short Japanese through', () => {
    expect(filterWhisperHallucination('はい')).toBe('はい')
    expect(filterWhisperHallucination('そう')).toBe('そう')
    expect(filterWhisperHallucination('なるほど')).toBe('なるほど')
  })

  it('passes valid longer Japanese through', () => {
    expect(filterWhisperHallucination('今日の議題について')).toBe('今日の議題について')
    expect(filterWhisperHallucination('会議を始めましょう')).toBe('会議を始めましょう')
  })

  it('filters mostly non-linguistic text', () => {
    expect(filterWhisperHallucination('###$$$%%%')).toBeNull()
    expect(filterWhisperHallucination('~!@#$%')).toBeNull()
  })

  it('passes valid text through', () => {
    expect(filterWhisperHallucination('The meeting starts at 3pm')).toBe('The meeting starts at 3pm')
    expect(filterWhisperHallucination('今日の議題について')).toBe('今日の議題について')
  })

  it('trims whitespace', () => {
    expect(filterWhisperHallucination('  hello world  ')).toBe('hello world')
  })
})
