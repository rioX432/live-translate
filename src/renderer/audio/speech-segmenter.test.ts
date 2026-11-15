import { describe, it, expect } from 'vitest'
import { SpeechSegmenter, createSegmentIdFactory, type SegmentAudio } from './speech-segmenter'

// vad-web's default (legacy Silero) model processes 1536-sample frames
const FRAME = 1536
const RATE = 16000

function frameOf(value: number): Float32Array {
  return new Float32Array(FRAME).fill(value)
}

function makeSegmenter(overrides: Partial<ConstructorParameters<typeof SpeechSegmenter>[0]> = {}) {
  let n = 0
  return new SpeechSegmenter({
    sampleRate: RATE,
    preRollSamples: FRAME * 3,
    maxSegmentSamples: FRAME * 40,
    splitSearchSamples: FRAME * 10,
    minInterimSamples: FRAME * 4,
    newId: () => `s${++n}`,
    ...overrides
  })
}

/** Feed frames the way vad-web does: the frame first, then the event it triggers. */
function speak(seg: SpeechSegmenter, count: number, startAt: number, value = 0.2): SegmentAudio[] {
  const out: SegmentAudio[] = []
  for (let i = 0; i < count; i++) {
    const r = seg.frame(frameOf(value), true, startAt + i * 32)
    if (r) out.push(r)
  }
  return out
}

describe('SpeechSegmenter', () => {
  it('keeps pre-roll and the frame that triggered speech start', () => {
    const seg = makeSegmenter()
    for (let i = 0; i < 6; i++) seg.frame(frameOf(0.001), false, i)
    seg.frame(frameOf(0.3), true, 100)
    seg.speechStart()
    seg.speechRealStart()
    const final = seg.speechEnd()!
    // 3 pre-roll frames + the triggering speech frame
    expect(final.audio.length).toBe(FRAME * 4)
    expect(final.audio[final.audio.length - 1]).toBeCloseTo(0.3)
  })

  it('gives each utterance exactly one final with its own id', () => {
    const seg = makeSegmenter()
    const finals: SegmentAudio[] = []
    for (const at of [0, 10_000]) {
      seg.frame(frameOf(0.2), true, at)
      seg.speechStart()
      speak(seg, 10, at + 32)
      seg.speechRealStart()
      finals.push(seg.speechEnd()!)
      expect(seg.speechEnd()).toBeNull()
    }
    expect(finals.map((f) => f.segmentId)).toEqual(['s1', 's2'])
    expect(finals.every((f) => f.kind === 'final')).toBe(true)
  })

  it('sends interims only after real start, only when they grew, and under the same id as the final', () => {
    const seg = makeSegmenter()
    seg.frame(frameOf(0.2), true, 0)
    seg.speechStart()
    speak(seg, 5, 32)
    expect(seg.interim()).toBeNull()
    seg.speechRealStart()
    const first = seg.interim()!
    expect(first.segmentId).toBe('s1')
    expect(seg.interim()).toBeNull()
    speak(seg, 2, 300)
    const second = seg.interim()!
    expect(second.audio.length).toBeGreaterThan(first.audio.length)
    expect(seg.speechEnd()!.segmentId).toBe('s1')
  })

  it('interims are not capped at a few seconds: they carry the whole segment', () => {
    const seg = makeSegmenter({ maxSegmentSamples: RATE * 30 })
    seg.frame(frameOf(0.2), true, 0)
    seg.speechStart()
    seg.speechRealStart()
    speak(seg, Math.ceil((RATE * 5) / FRAME), 32)
    expect(seg.interim()!.audio.length).toBeGreaterThan(RATE * 5)
  })

  it('a misfire before real start sends nothing', () => {
    const seg = makeSegmenter()
    seg.frame(frameOf(0.2), true, 0)
    seg.speechStart()
    expect(seg.misfire()).toBeNull()
    expect(seg.activeSegmentId).toBeNull()
  })

  it('stamps speechEndedAt with the last speech frame, not the trailing silence', () => {
    const seg = makeSegmenter()
    seg.frame(frameOf(0.2), true, 1000)
    seg.speechStart()
    seg.speechRealStart()
    seg.frame(frameOf(0.2), true, 1032)
    for (let i = 1; i <= 25; i++) seg.frame(frameOf(0.001), false, 1032 + i * 32)
    expect(seg.speechEnd()!.speechEndedAt).toBe(1032)
  })

  it('splits a long utterance at the quietest recent frame and continues under a new id', () => {
    const seg = makeSegmenter()
    seg.frame(frameOf(0.2), true, 0)
    seg.speechStart()
    seg.speechRealStart()
    const splits: SegmentAudio[] = []
    for (let i = 1; i < 60; i++) {
      // a short dip at frame 35 is where the cut should land
      const quiet = i === 35
      const r = seg.frame(frameOf(quiet ? 0.01 : 0.2), !quiet, i * 32)
      if (r) splits.push(r)
    }
    expect(splits).toHaveLength(1)
    expect(splits[0].segmentId).toBe('s1')
    expect(splits[0].audio.length).toBe(FRAME * 36)
    expect(seg.activeSegmentId).toBe('s2')
    // the continuation keeps sending interims without waiting for another real start
    expect(seg.interim()!.segmentId).toBe('s2')
    const final = seg.speechEnd()!
    expect(final.segmentId).toBe('s2')
    expect(splits[0].audio.length + final.audio.length).toBe(FRAME * 60)
  })

  it('does not split a segment the VAD may still call a misfire', () => {
    const seg = makeSegmenter()
    seg.frame(frameOf(0.2), true, 0)
    seg.speechStart()
    expect(speak(seg, 60, 32)).toEqual([])
  })

  it('flush closes a real segment on stop and drops a tentative one', () => {
    const seg = makeSegmenter()
    seg.frame(frameOf(0.2), true, 0)
    seg.speechStart()
    seg.speechRealStart()
    expect(seg.flush()!.segmentId).toBe('s1')

    seg.frame(frameOf(0.2), true, 100)
    seg.speechStart()
    expect(seg.flush()).toBeNull()
  })
})

describe('createSegmentIdFactory', () => {
  it('produces ids the main process accepts, distinct across page loads', () => {
    const a = createSegmentIdFactory(() => 0.1)
    const b = createSegmentIdFactory(() => 0.7)
    const ids = [a(), a(), b()]
    for (const id of ids) expect(id).toMatch(/^[A-Za-z0-9_-]{1,64}$/)
    expect(new Set(ids).size).toBe(3)
  })
})
