import { describe, it, expect, beforeEach } from 'vitest'
import { TranslationCache } from './TranslationCache'

describe('TranslationCache', () => {
  let cache: TranslationCache

  beforeEach(() => {
    cache = new TranslationCache(3)
  })

  it('starts empty', () => {
    expect(cache.size).toBe(0)
    expect(cache.stats.hits).toBe(0)
    expect(cache.stats.misses).toBe(0)
  })

  it('stores and retrieves a translation', () => {
    cache.set('hello', 'en', 'ja', 'こんにちは')
    expect(cache.get('hello', 'en', 'ja')).toBe('こんにちは')
  })

  it('returns undefined for cache miss', () => {
    expect(cache.get('hello', 'en', 'ja')).toBeUndefined()
  })

  it('tracks hit and miss counts', () => {
    cache.set('hello', 'en', 'ja', 'こんにちは')
    cache.get('hello', 'en', 'ja') // hit
    cache.get('world', 'en', 'ja') // miss
    cache.get('hello', 'en', 'ja') // hit

    expect(cache.stats.hits).toBe(2)
    expect(cache.stats.misses).toBe(1)
  })

  it('distinguishes by language pair', () => {
    cache.set('hello', 'en', 'ja', 'こんにちは')
    cache.set('hello', 'en', 'fr', 'bonjour')

    expect(cache.get('hello', 'en', 'ja')).toBe('こんにちは')
    expect(cache.get('hello', 'en', 'fr')).toBe('bonjour')
    expect(cache.get('hello', 'ja', 'en')).toBeUndefined()
  })

  it('evicts oldest entry when max size exceeded', () => {
    cache.set('one', 'en', 'ja', '1')
    cache.set('two', 'en', 'ja', '2')
    cache.set('three', 'en', 'ja', '3')
    cache.set('four', 'en', 'ja', '4') // should evict 'one'

    expect(cache.size).toBe(3)
    expect(cache.get('one', 'en', 'ja')).toBeUndefined()
    expect(cache.get('two', 'en', 'ja')).toBe('2')
    expect(cache.get('four', 'en', 'ja')).toBe('4')
  })

  it('refreshes position on get (LRU behavior)', () => {
    cache.set('one', 'en', 'ja', '1')
    cache.set('two', 'en', 'ja', '2')
    cache.set('three', 'en', 'ja', '3')

    // Access 'one' to make it most recently used
    cache.get('one', 'en', 'ja')

    // Add a new entry — should evict 'two' (oldest), not 'one'
    cache.set('four', 'en', 'ja', '4')

    expect(cache.get('one', 'en', 'ja')).toBe('1')
    expect(cache.get('two', 'en', 'ja')).toBeUndefined()
  })

  it('updates value for existing key without growing size', () => {
    cache.set('hello', 'en', 'ja', 'こんにちは')
    cache.set('hello', 'en', 'ja', 'やあ')

    expect(cache.size).toBe(1)
    expect(cache.get('hello', 'en', 'ja')).toBe('やあ')
  })

  it('clear resets entries and stats', () => {
    cache.set('hello', 'en', 'ja', 'こんにちは')
    cache.get('hello', 'en', 'ja')
    cache.get('world', 'en', 'ja')

    cache.clear()

    expect(cache.size).toBe(0)
    expect(cache.stats.hits).toBe(0)
    expect(cache.stats.misses).toBe(0)
    expect(cache.get('hello', 'en', 'ja')).toBeUndefined()
  })

  it('reports correct stats', () => {
    cache.set('a', 'en', 'ja', '1')
    cache.set('b', 'en', 'ja', '2')

    const stats = cache.stats
    expect(stats.size).toBe(2)
    expect(stats.maxSize).toBe(3)
  })

  it('buildKey produces correct format', () => {
    expect(TranslationCache.buildKey('hello', 'en', 'ja')).toBe('hello:en:ja')
  })

  it('handles colons in source text correctly', () => {
    cache.set('time: 3:00', 'en', 'ja', '時間: 3:00')
    cache.set('time: 4:00', 'en', 'ja', '時間: 4:00')

    expect(cache.get('time: 3:00', 'en', 'ja')).toBe('時間: 3:00')
    expect(cache.get('time: 4:00', 'en', 'ja')).toBe('時間: 4:00')
  })

  it('uses default max size of 500', () => {
    const defaultCache = new TranslationCache()
    expect(defaultCache.stats.maxSize).toBe(500)
  })

  it('enforces minimum size of 1', () => {
    const tinyCache = new TranslationCache(0)
    expect(tinyCache.stats.maxSize).toBe(1)

    tinyCache.set('a', 'en', 'ja', '1')
    tinyCache.set('b', 'en', 'ja', '2')
    expect(tinyCache.size).toBe(1)
  })
})
