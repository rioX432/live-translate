import { createLogger } from '../main/logger'

const log = createLogger('pipeline:cache')

const DEFAULT_MAX_SIZE = 500

export interface CacheStats {
  hits: number
  misses: number
  size: number
  maxSize: number
}

/**
 * LRU cache for translation results.
 * Eliminates redundant inference for repeated phrases during meetings.
 * Key format: `${sourceText}:${sourceLang}:${targetLang}`
 */
export class TranslationCache {
  private cache = new Map<string, string>()
  private maxSize: number
  private _hits = 0
  private _misses = 0

  constructor(maxSize = DEFAULT_MAX_SIZE) {
    this.maxSize = Math.max(1, maxSize)
  }

  /** Build cache key from translation parameters */
  static buildKey(sourceText: string, sourceLang: string, targetLang: string): string {
    return `${sourceText}:${sourceLang}:${targetLang}`
  }

  /** Look up a cached translation. Returns undefined on miss. */
  get(sourceText: string, sourceLang: string, targetLang: string): string | undefined {
    const key = TranslationCache.buildKey(sourceText, sourceLang, targetLang)
    const value = this.cache.get(key)
    if (value !== undefined) {
      // Move to end (most recently used) by re-inserting
      this.cache.delete(key)
      this.cache.set(key, value)
      this._hits++
      return value
    }
    this._misses++
    return undefined
  }

  /** Store a translation result in the cache. */
  set(sourceText: string, sourceLang: string, targetLang: string, translatedText: string): void {
    const key = TranslationCache.buildKey(sourceText, sourceLang, targetLang)

    // If key already exists, delete first to refresh position
    if (this.cache.has(key)) {
      this.cache.delete(key)
    }

    this.cache.set(key, translatedText)

    // Evict oldest entry if over capacity
    if (this.cache.size > this.maxSize) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) {
        this.cache.delete(oldest)
      }
    }
  }

  /** Clear all cached entries and reset stats. */
  clear(): void {
    const prevSize = this.cache.size
    this.cache.clear()
    this._hits = 0
    this._misses = 0
    if (prevSize > 0) {
      log.info(`Cache cleared (was ${prevSize} entries)`)
    }
  }

  /** Get cache hit/miss statistics. */
  get stats(): CacheStats {
    return {
      hits: this._hits,
      misses: this._misses,
      size: this.cache.size,
      maxSize: this.maxSize
    }
  }

  /** Current number of cached entries. */
  get size(): number {
    return this.cache.size
  }
}
