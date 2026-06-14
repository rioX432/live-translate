import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { MicrosoftTranslator } from './MicrosoftTranslator'

/**
 * Build a Response-like object that fetch() can return. The body is consumed
 * via .text() (used by api-utils' classifyErrorBody) or .json() on success.
 */
function makeResponse(status: number, body: string, ok = status < 400): Response {
  return {
    ok,
    status,
    text: async () => body,
    json: async () => JSON.parse(body)
  } as Response
}

describe('MicrosoftTranslator 429 classification (#703)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('classifies 429 with outOfQuota body as Quota exceeded', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(429, JSON.stringify({ error: { code: 403001, message: 'outOfQuota' } }))
    )
    const t = new MicrosoftTranslator('key', 'global')
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Quota exceeded/)
  })

  it('classifies 429 with quotaExceeded body as Quota exceeded', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(429, JSON.stringify({ error: { message: 'quotaExceeded' } }))
    )
    const t = new MicrosoftTranslator('key', 'global')
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Quota exceeded/)
  })

  it('classifies generic 429 as Rate limit', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(429, JSON.stringify({ error: { message: 'Too many requests' } }))
    )
    const t = new MicrosoftTranslator('key', 'global')
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Rate limit/)
  })

  it('passes through 401 as invalid key', async () => {
    fetchMock.mockResolvedValue(makeResponse(401, ''))
    const t = new MicrosoftTranslator('bad', 'global')
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Invalid API key/)
  })
})
