import { describe, it, expect, beforeEach } from 'vitest'
import { LocalAgreement } from './LocalAgreement'

describe('LocalAgreement', () => {
  let agreement: LocalAgreement

  beforeEach(() => {
    agreement = new LocalAgreement()
  })

  it('first update has no confirmed text', () => {
    const result = agreement.update('hello world')
    expect(result.confirmedText).toBe('')
    expect(result.newConfirmed).toBe('')
    expect(result.interimText).toBe('hello world')
  })

  it('confirms common prefix on second update', () => {
    agreement.update('hello world')
    const result = agreement.update('hello everyone')
    expect(result.confirmedText).toBe('hello ')
    expect(result.newConfirmed).toBe('hello ')
    expect(result.interimText).toBe('everyone')
  })

  it('handles CJK text character-by-character', () => {
    agreement.update('こんにちは世界')
    const result = agreement.update('こんにちは皆さん')
    expect(result.confirmedText).toBe('こんにちは')
    expect(result.newConfirmed).toBe('こんにちは')
  })

  it('finalize promotes all text to confirmed', () => {
    agreement.update('hello')
    const result = agreement.finalize('hello world final')
    expect(result.confirmedText).toBe('hello world final')
    expect(result.interimText).toBe('')
  })

  it('reset clears state', () => {
    agreement.update('hello world')
    agreement.update('hello world again')
    agreement.reset()
    const result = agreement.update('new text')
    expect(result.confirmedText).toBe('')
    expect(result.interimText).toBe('new text')
  })

  it('does not confirm partial English words', () => {
    agreement.update('international')
    const result = agreement.update('internet')
    // Should snap to word boundary (no space found, so empty)
    expect(result.confirmedText).toBe('')
  })

  it('handles identical consecutive transcripts', () => {
    agreement.update('hello world')
    const result = agreement.update('hello world')
    expect(result.confirmedText).toBe('hello world')
    expect(result.newConfirmed).toBe('hello world')
    expect(result.interimText).toBe('')
  })
})
