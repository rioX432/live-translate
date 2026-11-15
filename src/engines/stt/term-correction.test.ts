import { describe, expect, it } from 'vitest'
import type { GlossaryEntry } from '../types'
import {
  MAX_ASR_CONTEXT_TERMS,
  MAX_ASR_TERM_LENGTH,
  buildAsrContext,
  correctTranscript
} from './term-correction'

describe('correctTranscript', () => {
  const glossary: GlossaryEntry[] = [
    { source: 'アビィ', target: 'Avvy', aliases: ['アビー', 'あびい'] },
    { source: 'Avvy', target: 'アビィ', aliases: ['Abby', 'Ivy'] },
    { source: 'Project Nebulus', target: 'ネビュラス計画', aliases: ['Project Nebulous'] },
    { source: 'Nebulus', target: 'ネビュラス' }
  ]

  it('rewrites an alias to the registered spelling', () => {
    expect(correctTranscript('アビーの新機能です', glossary)).toBe('アビィの新機能です')
  })

  it('matches hiragana and katakana spellings of the same alias', () => {
    expect(correctTranscript('あびーの話', glossary)).toBe('アビィの話')
    expect(correctTranscript('アビイの話', glossary)).toBe('アビィの話')
  })

  it('normalizes the case of a latin term and its aliases', () => {
    expect(correctTranscript('I use abby and AVVY daily', glossary)).toBe('I use Avvy and Avvy daily')
  })

  it('does not rewrite a latin alias inside a longer word', () => {
    expect(correctTranscript('Abbyville and Ivyleague', glossary)).toBe('Abbyville and Ivyleague')
  })

  it('prefers the longest term at the same position', () => {
    expect(correctTranscript('Project Nebulous starts', glossary)).toBe('Project Nebulus starts')
  })

  it('does not rewrite a replacement again', () => {
    const chained: GlossaryEntry[] = [
      { source: 'Bravo', target: 'x', aliases: ['Alpha'] },
      { source: 'Charlie', target: 'y', aliases: ['Bravo'] }
    ]
    expect(correctTranscript('Alpha', chained)).toBe('Bravo')
  })

  it('never rewrites a registered term listed as another entry\'s alias', () => {
    const g: GlossaryEntry[] = [
      { source: 'Halcyon', target: 'ハルシオン', aliases: ['Solania'] },
      { source: 'Solania', target: 'ソラニア' }
    ]
    expect(correctTranscript('Solania and Halcyon', g)).toBe('Solania and Halcyon')
  })

  it('ignores aliases shorter than two characters', () => {
    const g: GlossaryEntry[] = [{ source: 'アビィ', target: 'Avvy', aliases: ['ア'] }]
    expect(correctTranscript('アイデア', g)).toBe('アイデア')
  })

  it('skips sentence-length entries left by older builds', () => {
    const long = 'あ'.repeat(MAX_ASR_TERM_LENGTH + 1)
    const g: GlossaryEntry[] = [{ source: long, target: 'x', aliases: ['テスト'] }]
    expect(correctTranscript('テストです', g)).toBe('テストです')
  })

  it('treats regex metacharacters in terms literally', () => {
    const g: GlossaryEntry[] = [{ source: 'C++ SDK', target: 'C++ SDK', aliases: ['C plus plus SDK'] }]
    expect(correctTranscript('the C plus plus SDK and C++ SDK', g)).toBe('the C++ SDK and C++ SDK')
    expect(correctTranscript('CCC SDK', g)).toBe('CCC SDK')
  })

  it('leaves text unchanged without a glossary', () => {
    expect(correctTranscript('アビーです', undefined)).toBe('アビーです')
    expect(correctTranscript('アビーです', [])).toBe('アビーです')
  })

  it('matches a half-width kana alias as registered and in its full-width form', () => {
    const halfWidth: GlossaryEntry[] = [{ source: 'Gamma', target: 'ガンマ', aliases: ['ｶﾞﾝﾏ'] }]
    expect(correctTranscript('ｶﾞﾝﾏの話', halfWidth)).toBe('Gammaの話')
    expect(correctTranscript('ガンマの話', halfWidth)).toBe('Gammaの話')
  })

  it('keeps accented latin words whole but matches next to Japanese', () => {
    const accented: GlossaryEntry[] = [{ source: 'Canon', target: 'キヤノン', aliases: ['café'] }]
    expect(correctTranscript('décafé caféville café', accented)).toBe('décafé caféville Canon')
    expect(correctTranscript('アビィとabbyの話', glossary)).toBe('アビィとAvvyの話')
  })

  it('applies a glossary edit on the next call', () => {
    const before: GlossaryEntry[] = [{ source: 'アビィ', target: 'Avvy' }]
    expect(correctTranscript('アビーです', before)).toBe('アビーです')
    const after: GlossaryEntry[] = [{ source: 'アビィ', target: 'Avvy', aliases: ['アビー'] }]
    expect(correctTranscript('アビーです', after)).toBe('アビィです')
  })
})

describe('buildAsrContext', () => {
  it('lists both sides of each entry once and leaves aliases out', () => {
    const g: GlossaryEntry[] = [
      { source: 'アビィ', target: 'Avvy', aliases: ['アビー'] },
      { source: 'Avvy', target: 'アビィ' },
      { source: 'ルミナリス', target: 'Luminaris' }
    ]
    expect(buildAsrContext(g)).toBe('アビィ, Avvy, ルミナリス, Luminaris')
  })

  it('caps the number of terms', () => {
    const g: GlossaryEntry[] = Array.from({ length: MAX_ASR_CONTEXT_TERMS }, (_, i) => ({
      source: `term${i}`,
      target: `語${i}`
    }))
    expect(buildAsrContext(g).split(', ')).toHaveLength(MAX_ASR_CONTEXT_TERMS)
  })

  it('returns an empty context without usable terms', () => {
    expect(buildAsrContext(undefined)).toBe('')
    expect(buildAsrContext([{ source: 'あ'.repeat(MAX_ASR_TERM_LENGTH + 1), target: 'x' }])).toBe('')
  })
})
