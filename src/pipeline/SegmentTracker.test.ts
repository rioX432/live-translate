import { describe, it, expect } from 'vitest'
import { SegmentTracker } from './SegmentTracker'

describe('SegmentTracker', () => {
  it('opens a segment on its first interim and keeps accepting interims while open', () => {
    const t = new SegmentTracker()
    expect(t.touchInterim('a')).toBe(true)
    expect(t.touchInterim('a')).toBe(true)
    expect(t.phase('a')).toBe('open')
    expect(t.mayEmitInterim('a')).toBe(true)
  })

  it('claims the final once; a second final for the same segment is rejected', () => {
    const t = new SegmentTracker()
    t.touchInterim('a')
    expect(t.beginFinalize('a')).toBe(true)
    expect(t.beginFinalize('a')).toBe(false)
    t.markFinalized('a')
    expect(t.beginFinalize('a')).toBe(false)
  })

  it('a final without any interim is still accepted', () => {
    const t = new SegmentTracker()
    expect(t.beginFinalize('short')).toBe(true)
  })

  it('stops interim output as soon as the final is claimed', () => {
    const t = new SegmentTracker()
    t.touchInterim('a')
    t.beginFinalize('a')
    expect(t.mayEmitInterim('a')).toBe(false)
    expect(t.touchInterim('a')).toBe(false)
    t.markFinalized('a')
    expect(t.touchInterim('a')).toBe(false)
    expect(t.phase('a')).toBe('finalized')
  })

  it('segments are independent', () => {
    const t = new SegmentTracker()
    t.beginFinalize('a')
    expect(t.touchInterim('b')).toBe(true)
    expect(t.beginFinalize('b')).toBe(true)
  })

  it('remembers recent segments and forgets the oldest beyond its bound', () => {
    const t = new SegmentTracker()
    t.beginFinalize('old')
    for (let i = 0; i < 64; i++) t.beginFinalize(`s${i}`)
    expect(t.phase('old')).toBeUndefined()
    expect(t.phase('s63')).toBe('finalizing')
    expect(t.beginFinalize('s1')).toBe(false)
  })

  it('reset forgets every segment', () => {
    const t = new SegmentTracker()
    t.beginFinalize('a')
    t.reset()
    expect(t.phase('a')).toBeUndefined()
  })
})
