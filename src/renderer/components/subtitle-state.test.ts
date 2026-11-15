import { describe, it, expect } from 'vitest'
import { INITIAL_SUBTITLE_STATE, subtitleReducer, type SubtitleAction, type SubtitleResult, type SubtitleState } from './subtitle-state'

function run(...actions: SubtitleAction[]): SubtitleState {
  return actions.reduce(subtitleReducer, INITIAL_SUBTITLE_STATE)
}

const interim = (segmentId: string | undefined, sourceText: string, translatedText = '', extra: Partial<SubtitleResult> = {}): SubtitleAction =>
  ({ type: 'result', final: false, result: { segmentId, sourceText, translatedText, ...extra } })
const final = (segmentId: string | undefined, sourceText: string, translatedText: string): SubtitleAction =>
  ({ type: 'result', final: true, result: { segmentId, sourceText, translatedText } })

describe('subtitleReducer', () => {
  it('a late interim never overwrites the final of its segment', () => {
    const s = run(interim('s1', 'good'), final('s1', 'good morning', 'おはよう'), interim('s1', 'good', 'LATE'))
    expect(s.current).toMatchObject({ segmentId: 's1', confirmedText: 'good morning', translatedText: 'おはよう', final: true })
  })

  it('keeps a segment translation while its interim text grows', () => {
    const s = run(interim('s1', 'good', 'よい'), interim('s1', 'good morning'))
    expect(s.current?.translatedText).toBe('よい')
  })

  it('a new segment does not inherit the previous translation, and the previous line stays visible', () => {
    const s = run(final('s1', 'first', '一つ目'), interim('s2', 'second'))
    expect(s.current).toMatchObject({ segmentId: 's2', translatedText: '' })
    expect(s.previous).toMatchObject({ segmentId: 's1', translatedText: '一つ目' })
  })

  it('a final that arrives after the next segment started lands on the earlier line', () => {
    const s = run(interim('s1', 'one'), interim('s2', 'two'), final('s1', 'one done', '一'))
    expect(s.current).toMatchObject({ segmentId: 's2', final: false })
    expect(s.previous).toMatchObject({ segmentId: 's1', final: true, translatedText: '一' })
  })

  it('a final for an unseen older segment shows above the live line', () => {
    const s = run(interim('s2', 'two'), final('s1', 'one', '一'))
    expect(s.current?.segmentId).toBe('s2')
    expect(s.previous?.segmentId).toBe('s1')
  })

  it('a dropped segment takes its interim off the screen and restores the last final', () => {
    const s = run(final('s1', 'one', '一'), interim('s2', 'uh'), { type: 'dropped', segmentId: 's2' })
    expect(s.current?.segmentId).toBe('s1')
    expect(s.previous).toBeNull()
    expect(subtitleReducer(s, interim('s2', 'uh again'))).toBe(s)
  })

  it('a dropped segment leaves a final alone', () => {
    const s = run(final('s1', 'one', '一'), { type: 'dropped', segmentId: 's1' })
    expect(s.current?.segmentId).toBe('s1')
  })

  it('ignores empty source text', () => {
    const s = run(final('s1', 'one', '一'), interim('s2', '  '))
    expect(s.current?.segmentId).toBe('s1')
  })

  it('uses the confirmed / interim split while live and the full text once final', () => {
    const live = run(interim('s1', 'hello wor', '', { confirmedText: 'hello ', interimText: 'wor' }))
    expect(live.current).toMatchObject({ confirmedText: 'hello ', interimText: 'wor' })
    const done = subtitleReducer(live, final('s1', 'hello world', 'こんにちは'))
    expect(done.current).toMatchObject({ confirmedText: 'hello world', interimText: '' })
  })

  it('without segment ids, each final starts a new line', () => {
    const s = run(final(undefined, 'one', '一'), final(undefined, 'two', '二'))
    expect(s.current?.confirmedText).toBe('two')
    expect(s.previous?.confirmedText).toBe('one')
  })

  it('a draft without a segment id updates the live line instead of starting a new one', () => {
    const s = run(interim('s1', 'one'), interim(undefined, 'one', '一（下書き）'), final('s1', 'one', '一'))
    expect(s.previous).toBeNull()
    expect(s.current).toMatchObject({ segmentId: 's1', final: true, translatedText: '一' })
  })

  it('a correction lands on the line that was edited, even after the next utterance started', () => {
    const s = run(final('s1', 'one', '1'), interim('s2', 'two'), { type: 'corrected', segmentId: 's1', translatedText: '一' })
    expect(s.previous?.translatedText).toBe('一')
    expect(s.current?.translatedText).toBe('')
  })

  it('shows a pipeline error until a final gets through or the pipeline runs again', () => {
    const failed = run({ type: 'status', state: 'running', error: 'Speech recognition failed' })
    expect(failed.error).toBe('Speech recognition failed')
    expect(subtitleReducer(failed, { type: 'status', state: 'recovering' }).error).toBe('Speech recognition failed')
    expect(subtitleReducer(failed, { type: 'status', state: 'running' }).error).toBeNull()
    expect(subtitleReducer(failed, final('s9', 'back', '復帰')).error).toBeNull()
  })
})
