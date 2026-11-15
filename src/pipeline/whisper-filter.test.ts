import { describe, it, expect, vi } from 'vitest'
import { filterWhisperHallucination } from './whisper-filter'

describe('filterWhisperHallucination', () => {
  it('returns null for short text', () => {
    expect(filterWhisperHallucination('a')).toBeNull()
    expect(filterWhisperHallucination(' ')).toBeNull()
  })

  it('filters known hallucination phrases', () => {
    expect(filterWhisperHallucination('thanks for watching')).toBeNull()
    expect(filterWhisperHallucination('ご視聴ありがとうございました')).toBeNull()
    expect(filterWhisperHallucination('subscribe')).toBeNull()
  })

  it('filters with trailing punctuation', () => {
    expect(filterWhisperHallucination('Thanks for watching.')).toBeNull()
    expect(filterWhisperHallucination('Thanks for watching!')).toBeNull()
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

  it('filters a single kana', () => {
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

describe('filterWhisperHallucination logging', () => {
  it('never writes the recognized text to the console', () => {
    const spy = vi.spyOn(console, 'debug').mockImplementation(() => {})
    const secret = 'CONFIDENTIAL-MEETING-TEXT'
    filterWhisperHallucination('thank you')
    filterWhisperHallucination(`${secret} ${secret} ${secret} ${secret}`)
    filterWhisperHallucination('ああ')
    const logged = spy.mock.calls.flat().join(' ')
    spy.mockRestore()
    expect(logged).not.toContain('thank you')
    expect(logged).not.toContain(secret)
  })
})

describe('filterWhisperHallucination in meetings', () => {
  it('keeps a stock meeting phrase spoken on its own', () => {
    for (const phrase of [
      'よろしくお願いします',
      'ありがとうございます',
      'ありがとうございました',
      'お願いします',
      'お疲れ様です',
      'お疲れ様でした',
      'それでは',
      'Thank you.',
      'Goodbye',
      'See you next time'
    ]) {
      expect(filterWhisperHallucination(phrase)).toBe(phrase)
    }
  })

  it('keeps short kana replies that are common in meetings', () => {
    for (const reply of ['そうです', 'ですね', 'いいね', 'わかった', 'はいはい', 'ほんと']) {
      expect(filterWhisperHallucination(reply)).toBe(reply)
    }
  })
})
