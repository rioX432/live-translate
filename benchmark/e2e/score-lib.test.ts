import { describe, expect, it } from 'vitest'
import { normalizeForErrorRate, percentile, scoreUtterances, type RunEvent, type Utterance } from './score-lib'

const utt = (id: string, lang: 'ja' | 'en', text: string, start: number, end: number): Utterance => ({
  id,
  lang,
  text,
  ref: '',
  start,
  end
})

describe('scoreUtterances', () => {
  const utts = [utt('a', 'ja', '今日は晴れです。', 1.0, 3.0), utt('b', 'en', 'See you later.', 6.0, 8.0)]

  it('measures first source/translation from speech onset and final from speech offset', () => {
    const events: RunEvent[] = [
      { t: 1.1, kind: 'vad-start', seg: 0 },
      { t: 2.0, kind: 'interim', seg: 0, src: '今日は' },
      { t: 2.5, kind: 'interim', seg: 0, src: '今日は晴れ', tr: 'Today is sunny' },
      { t: 3.4, kind: 'vad-end', seg: 0 },
      { t: 4.0, kind: 'final', seg: 0, src: '今日は晴れです', tr: 'It is sunny today.', lang: 'ja', tgt: 'en' }
    ]
    const [a, b] = scoreUtterances(events, utts)
    expect(a.firstSrcLatency).toBeCloseTo(1.0)
    expect(a.firstTrLatency).toBeCloseTo(1.5)
    expect(a.finalLatency).toBeCloseTo(1.0)
    expect(a.errorRate).toBe(0)
    expect(a.detectedLang).toBe('ja')
    expect(b.finalLatency).toBeNull()
    expect(b.errorRate).toBe(1)
  })

  it('joins a VAD split into one hypothesis and times the final from the last piece', () => {
    const events: RunEvent[] = [
      { t: 6.1, kind: 'vad-start', seg: 1 },
      { t: 6.9, kind: 'vad-end', seg: 1 },
      { t: 7.0, kind: 'vad-start', seg: 2 },
      { t: 8.5, kind: 'vad-end', seg: 2 },
      { t: 7.5, kind: 'final', seg: 1, src: 'See you', tr: 'またね', lang: 'en', tgt: 'ja' },
      { t: 9.2, kind: 'final', seg: 2, src: 'later.', tr: '後で', lang: 'en', tgt: 'ja' }
    ]
    const b = scoreUtterances(events, utts)[1]
    expect(b.segs).toEqual([1, 2])
    expect(b.hypSrc).toBe('See you later.')
    expect(b.hypTr).toBe('またね後で')
    expect(b.finalLatency).toBeCloseTo(1.2)
    expect(b.errorRate).toBe(0)
  })

  it('does not count a translation carried over from the previous utterance as new', () => {
    const events: RunEvent[] = [
      { t: 4.0, kind: 'final', seg: 0, src: '今日は晴れです', tr: 'It is sunny today.', lang: 'ja', tgt: 'en' },
      { t: 6.1, kind: 'vad-start', seg: 1 },
      { t: 6.8, kind: 'interim', seg: 1, src: 'See', tr: 'It is sunny today.' },
      { t: 7.6, kind: 'interim', seg: 1, src: 'See you', tr: 'またね' }
    ]
    const b = scoreUtterances(events, utts)[1]
    expect(b.firstSrcLatency).toBeCloseTo(0.8)
    expect(b.firstTrLatency).toBeCloseTo(1.6)
  })

  it('counts interim rewrites and erased characters', () => {
    const events: RunEvent[] = [
      { t: 1.1, kind: 'vad-start', seg: 0 },
      { t: 1.5, kind: 'interim', seg: 0, src: '今日は' },
      { t: 2.0, kind: 'interim', seg: 0, src: '今日の' },
      { t: 2.5, kind: 'interim', seg: 0, src: '今日の天気' }
    ]
    const a = scoreUtterances(events, utts)[0]
    expect(a.interimUpdates).toBe(2)
    expect(a.erasedChars).toBe(1)
  })
})

describe('normalizeForErrorRate', () => {
  it('drops punctuation, keeps digits and %, folds width and case', () => {
    expect(normalizeForErrorRate('Ｈｅｌｌｏ、世界！ 20%。')).toBe('hello 世界 20%')
  })
})

describe('percentile', () => {
  it('interpolates linearly and handles empty input', () => {
    expect(percentile([3, 1, 2, 4], 0.5)).toBe(2.5)
    expect(percentile([], 0.5)).toBeNull()
  })
})
