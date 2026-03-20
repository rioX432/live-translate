import { describe, it, expect, vi } from 'vitest'
import { HybridTranslator } from './HybridTranslator'
import type { TranslatorEngine, TranslationResult } from '../types'

function createMockEngine(id: string, result = 'translated'): TranslatorEngine {
  return {
    id,
    name: `Mock ${id}`,
    isOffline: true,
    initialize: vi.fn(async () => {}),
    translate: vi.fn(async () => result),
    dispose: vi.fn(async () => {})
  }
}

describe('HybridTranslator', () => {
  it('returns refined text when it differs from draft', async () => {
    const draft = createMockEngine('draft', 'draft translation')
    const refine = createMockEngine('refine', 'refined translation')
    const hybrid = new HybridTranslator(draft, refine)

    const result = await hybrid.translate('hello', 'en', 'ja')
    expect(result).toBe('refined translation')
  })

  it('returns draft text when refined matches', async () => {
    const draft = createMockEngine('draft', 'same translation')
    const refine = createMockEngine('refine', 'same translation')
    const hybrid = new HybridTranslator(draft, refine)

    const result = await hybrid.translate('hello', 'en', 'ja')
    expect(result).toBe('same translation')
  })

  it('emits draft via onDraft callback', async () => {
    const draft = createMockEngine('draft', 'draft text')
    const refine = createMockEngine('refine', 'refined text')
    const hybrid = new HybridTranslator(draft, refine)

    const drafts: TranslationResult[] = []
    hybrid.setOnDraft((d) => drafts.push(d))

    await hybrid.translate('hello', 'en', 'ja')

    expect(drafts).toHaveLength(1)
    expect(drafts[0].translatedText).toBe('draft text')
    expect(drafts[0].translationStage).toBe('draft')
    expect(drafts[0].sourceText).toBe('hello')
  })

  it('falls back to draft when refinement fails', async () => {
    const draft = createMockEngine('draft', 'draft text')
    const refine = createMockEngine('refine', '')
    ;(refine.translate as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('LLM error'))
    const hybrid = new HybridTranslator(draft, refine)

    const result = await hybrid.translate('hello', 'en', 'ja')
    expect(result).toBe('draft text')
  })

  it('returns empty string for empty input', async () => {
    const draft = createMockEngine('draft', 'x')
    const refine = createMockEngine('refine', 'y')
    const hybrid = new HybridTranslator(draft, refine)

    expect(await hybrid.translate('', 'en', 'ja')).toBe('')
    expect(await hybrid.translate('  ', 'en', 'ja')).toBe('')
  })

  it('returns input text when from === to', async () => {
    const draft = createMockEngine('draft', 'x')
    const refine = createMockEngine('refine', 'y')
    const hybrid = new HybridTranslator(draft, refine)

    expect(await hybrid.translate('hello', 'en', 'en')).toBe('hello')
  })

  it('initializes both engines', async () => {
    const draft = createMockEngine('draft')
    const refine = createMockEngine('refine')
    const hybrid = new HybridTranslator(draft, refine)

    await hybrid.initialize()
    expect(draft.initialize).toHaveBeenCalled()
    expect(refine.initialize).toHaveBeenCalled()
  })

  it('disposes both engines safely', async () => {
    const draft = createMockEngine('draft')
    const refine = createMockEngine('refine')
    const hybrid = new HybridTranslator(draft, refine)

    await hybrid.dispose()
    expect(draft.dispose).toHaveBeenCalled()
    expect(refine.dispose).toHaveBeenCalled()
  })

  it('disposes both engines even if one fails', async () => {
    const draft = createMockEngine('draft')
    const refine = createMockEngine('refine')
    ;(draft.dispose as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fail'))
    const hybrid = new HybridTranslator(draft, refine)

    await hybrid.dispose()
    expect(draft.dispose).toHaveBeenCalled()
    expect(refine.dispose).toHaveBeenCalled()
  })

  it('passes context to both engines', async () => {
    const draft = createMockEngine('draft', 'a')
    const refine = createMockEngine('refine', 'b')
    const hybrid = new HybridTranslator(draft, refine)

    const ctx = { previousSegments: [{ source: 'x', translated: 'y' }] }
    await hybrid.translate('hello', 'en', 'ja', ctx)

    expect(draft.translate).toHaveBeenCalledWith('hello', 'en', 'ja', ctx)
    expect(refine.translate).toHaveBeenCalledWith('hello', 'en', 'ja', ctx)
  })
})
