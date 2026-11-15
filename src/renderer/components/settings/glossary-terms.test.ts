import { describe, expect, it } from 'vitest'
import { termFromInput, upsertTerm, type GlossaryTerm } from './glossary-terms'

describe('termFromInput', () => {
  it('trims the fields and splits aliases on ASCII and Japanese commas', () => {
    expect(termFromInput(' アビィ ', ' Avvy ', 'アビー、 アビ, ,アビー, アビィ')).toEqual({
      source: 'アビィ',
      target: 'Avvy',
      aliases: ['アビー', 'アビ']
    })
  })

  it('leaves aliases out when none are given', () => {
    expect(termFromInput('Avvy', 'アビィ', '  ')).toEqual({ source: 'Avvy', target: 'アビィ' })
  })

  it('returns null until both sides are filled in', () => {
    expect(termFromInput('Avvy', ' ', '')).toBeNull()
    expect(termFromInput('', 'アビィ', '')).toBeNull()
  })
})

describe('upsertTerm', () => {
  const terms: GlossaryTerm[] = [
    { source: 'A', target: '1' },
    { source: 'B', target: '2' },
    { source: 'C', target: '3' }
  ]

  it('appends a new source', () => {
    expect(upsertTerm(terms, { source: 'D', target: '4' }).map((t) => t.source)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('replaces an entry that has the same source in place', () => {
    expect(upsertTerm(terms, { source: 'B', target: '9' })).toEqual([
      { source: 'A', target: '1' },
      { source: 'B', target: '9' },
      { source: 'C', target: '3' }
    ])
  })

  it('edits by position and drops another entry the new source would duplicate', () => {
    expect(upsertTerm(terms, { source: 'C', target: '9', aliases: ['see'] }, 0)).toEqual([
      { source: 'C', target: '9', aliases: ['see'] },
      { source: 'B', target: '2' }
    ])
  })
})
