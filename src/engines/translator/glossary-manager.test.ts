import { describe, it, expect } from 'vitest'
import {
  parseJsonGlossary,
  parseCsvGlossary,
  exportJsonGlossary,
  exportCsvGlossary,
  mergeGlossaries,
  detectGlossaryFormat,
  parseGlossary
} from './glossary-manager'

describe('parseJsonGlossary', () => {
  it('parses valid JSON array', () => {
    const input = JSON.stringify([
      { source: 'AI', target: 'Artificial Intelligence' },
      { source: 'ML', target: 'Machine Learning' }
    ])
    const result = parseJsonGlossary(input)
    expect(result).toEqual([
      { source: 'AI', target: 'Artificial Intelligence' },
      { source: 'ML', target: 'Machine Learning' }
    ])
  })

  it('skips entries with missing fields', () => {
    const input = JSON.stringify([
      { source: 'AI', target: 'Artificial Intelligence' },
      { source: 'ML' },
      { target: 'Something' },
      { source: '', target: 'Empty' }
    ])
    const result = parseJsonGlossary(input)
    expect(result).toEqual([{ source: 'AI', target: 'Artificial Intelligence' }])
  })

  it('trims whitespace from terms', () => {
    const input = JSON.stringify([{ source: '  AI  ', target: '  人工知能  ' }])
    const result = parseJsonGlossary(input)
    expect(result).toEqual([{ source: 'AI', target: '人工知能' }])
  })

  it('throws on non-array JSON', () => {
    expect(() => parseJsonGlossary('{"source": "AI"}')).toThrow('must be an array')
  })
})

describe('parseCsvGlossary', () => {
  it('parses CSV with header', () => {
    const csv = 'source,target\nAI,Artificial Intelligence\nML,Machine Learning'
    const result = parseCsvGlossary(csv)
    expect(result).toEqual([
      { source: 'AI', target: 'Artificial Intelligence' },
      { source: 'ML', target: 'Machine Learning' }
    ])
  })

  it('handles quoted fields with commas', () => {
    const csv = 'source,target\n"hello, world","こんにちは、世界"'
    const result = parseCsvGlossary(csv)
    expect(result).toEqual([{ source: 'hello, world', target: 'こんにちは、世界' }])
  })

  it('handles escaped quotes', () => {
    const csv = 'source,target\n"say ""hello""","挨拶"'
    const result = parseCsvGlossary(csv)
    expect(result).toEqual([{ source: 'say "hello"', target: '挨拶' }])
  })

  it('returns empty for header-only CSV', () => {
    const result = parseCsvGlossary('source,target')
    expect(result).toEqual([])
  })

  it('skips blank rows', () => {
    const csv = 'source,target\nAI,人工知能\n\nML,機械学習'
    const result = parseCsvGlossary(csv)
    expect(result).toEqual([
      { source: 'AI', target: '人工知能' },
      { source: 'ML', target: '機械学習' }
    ])
  })

  it('handles Windows-style line endings', () => {
    const csv = 'source,target\r\nAI,人工知能\r\nML,機械学習'
    const result = parseCsvGlossary(csv)
    expect(result).toHaveLength(2)
  })
})

describe('exportJsonGlossary', () => {
  it('exports valid JSON', () => {
    const entries = [{ source: 'AI', target: '人工知能' }]
    const json = exportJsonGlossary(entries)
    expect(JSON.parse(json)).toEqual([{ source: 'AI', target: '人工知能' }])
  })
})

describe('exportCsvGlossary', () => {
  it('exports CSV with header', () => {
    const entries = [
      { source: 'AI', target: '人工知能' },
      { source: 'ML', target: '機械学習' }
    ]
    const csv = exportCsvGlossary(entries)
    expect(csv).toBe('source,target\nAI,人工知能\nML,機械学習')
  })

  it('escapes fields with commas', () => {
    const entries = [{ source: 'hello, world', target: 'greeting' }]
    const csv = exportCsvGlossary(entries)
    expect(csv).toBe('source,target\n"hello, world",greeting')
  })
})

describe('mergeGlossaries', () => {
  it('merges without conflicts', () => {
    const personal = [{ source: 'AI', target: 'Artificial Intelligence' }]
    const org = [{ source: 'ML', target: 'Machine Learning' }]
    const merged = mergeGlossaries(personal, org)
    expect(merged).toHaveLength(2)
    expect(merged).toContainEqual({ source: 'AI', target: 'Artificial Intelligence' })
    expect(merged).toContainEqual({ source: 'ML', target: 'Machine Learning' })
  })

  it('org overrides personal on conflict', () => {
    const personal = [{ source: 'AI', target: 'My AI Definition' }]
    const org = [{ source: 'AI', target: 'Org AI Definition' }]
    const merged = mergeGlossaries(personal, org)
    expect(merged).toHaveLength(1)
    expect(merged[0].target).toBe('Org AI Definition')
  })

  it('handles empty arrays', () => {
    expect(mergeGlossaries([], [])).toEqual([])
    expect(mergeGlossaries([{ source: 'A', target: 'B' }], [])).toEqual([{ source: 'A', target: 'B' }])
    expect(mergeGlossaries([], [{ source: 'A', target: 'B' }])).toEqual([{ source: 'A', target: 'B' }])
  })
})

describe('detectGlossaryFormat', () => {
  it('detects JSON', () => {
    expect(detectGlossaryFormat('glossary.json')).toBe('json')
    expect(detectGlossaryFormat('my-terms.JSON')).toBe('json')
  })

  it('detects CSV', () => {
    expect(detectGlossaryFormat('glossary.csv')).toBe('csv')
    expect(detectGlossaryFormat('terms.CSV')).toBe('csv')
  })

  it('returns null for unknown', () => {
    expect(detectGlossaryFormat('glossary.txt')).toBeNull()
    expect(detectGlossaryFormat('glossary')).toBeNull()
  })
})

describe('parseGlossary', () => {
  it('delegates to correct parser', () => {
    const json = JSON.stringify([{ source: 'A', target: 'B' }])
    expect(parseGlossary(json, 'json')).toEqual([{ source: 'A', target: 'B' }])

    const csv = 'source,target\nA,B'
    expect(parseGlossary(csv, 'csv')).toEqual([{ source: 'A', target: 'B' }])
  })
})
