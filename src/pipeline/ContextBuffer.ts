import type { TranslateContext, GlossaryEntry } from '../engines/types'

const DEFAULT_MAX_SEGMENTS = 3

/**
 * Ring buffer that stores recent confirmed translation segments.
 * Provides context to translators that support context-aware translation.
 */
export class ContextBuffer {
  private segments: Array<{ source: string; translated: string; speakerId?: string }> = []
  private maxSegments: number

  constructor(maxSegments = DEFAULT_MAX_SEGMENTS) {
    this.maxSegments = maxSegments
  }

  /** Add a confirmed translation segment */
  add(source: string, translated: string, speakerId?: string): void {
    this.segments.push({ source, translated, speakerId })
    if (this.segments.length > this.maxSegments) {
      this.segments.shift()
    }
  }

  /** Get the current context for translation */
  getContext(glossary?: GlossaryEntry[], speakerId?: string): TranslateContext {
    return {
      previousSegments: [...this.segments],
      glossary,
      speakerId
    }
  }

  /** Clear all stored segments */
  reset(): void {
    this.segments = []
  }
}
