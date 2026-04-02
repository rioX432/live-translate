import { describe, it, expect, beforeEach } from 'vitest'
import { ContextBuffer } from './ContextBuffer'

describe('ContextBuffer', () => {
  let buffer: ContextBuffer

  beforeEach(() => {
    buffer = new ContextBuffer(3)
  })

  it('starts empty', () => {
    const ctx = buffer.getContext()
    expect(ctx.previousSegments).toEqual([])
  })

  it('stores added segments', () => {
    buffer.add('hello', 'こんにちは')
    const ctx = buffer.getContext()
    expect(ctx.previousSegments).toHaveLength(1)
    expect(ctx.previousSegments[0]).toEqual({ source: 'hello', translated: 'こんにちは' })
  })

  it('evicts oldest when max reached', () => {
    buffer.add('one', '1')
    buffer.add('two', '2')
    buffer.add('three', '3')
    buffer.add('four', '4')
    const ctx = buffer.getContext()
    expect(ctx.previousSegments).toHaveLength(3)
    expect(ctx.previousSegments[0]).toEqual({ source: 'two', translated: '2' })
  })

  it('reset clears all segments', () => {
    buffer.add('hello', 'world')
    buffer.reset()
    expect(buffer.getContext().previousSegments).toEqual([])
  })

  it('returns a copy, not a reference', () => {
    buffer.add('hello', 'world')
    const ctx1 = buffer.getContext()
    buffer.add('foo', 'bar')
    const ctx2 = buffer.getContext()
    expect(ctx1.previousSegments).toHaveLength(1)
    expect(ctx2.previousSegments).toHaveLength(2)
  })

  it('passes glossary in context', () => {
    buffer.add('hello', 'world')
    const glossary = [{ source: 'API', target: 'API' }]
    const ctx = buffer.getContext(glossary)
    expect(ctx.glossary).toEqual(glossary)
  })

  it('returns undefined glossary when not provided', () => {
    buffer.add('hello', 'world')
    const ctx = buffer.getContext()
    expect(ctx.glossary).toBeUndefined()
  })
})
