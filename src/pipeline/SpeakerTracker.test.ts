import { describe, it, expect, beforeEach } from 'vitest'
import { SpeakerTracker } from './SpeakerTracker'

describe('SpeakerTracker', () => {
  let tracker: SpeakerTracker

  beforeEach(() => {
    tracker = new SpeakerTracker()
  })

  it('starts with Speaker A', () => {
    expect(tracker.getSpeakerId()).toBe('Speaker A')
  })

  it('keeps same speaker for close timestamps', () => {
    const id1 = tracker.update(1000)
    const id2 = tracker.update(1500)
    expect(id1).toBe('Speaker A')
    expect(id2).toBe('Speaker A')
  })

  it('changes speaker on large gap', () => {
    tracker.update(1000)
    const id = tracker.update(4000) // 3s gap > 2s threshold
    expect(id).toBe('Speaker B')
  })

  it('cycles through speakers', () => {
    tracker.update(1000)
    tracker.update(4000) // B
    const id = tracker.update(7000) // C
    expect(id).toBe('Speaker C')
  })

  it('reset goes back to Speaker A', () => {
    tracker.update(0)
    tracker.update(3000)
    tracker.reset()
    expect(tracker.getSpeakerId()).toBe('Speaker A')
  })
})
