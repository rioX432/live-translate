import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GoogleTranslator } from './GoogleTranslator'

function makeResponse(status: number, body: string, ok = status < 400): Response {
  return {
    ok,
    status,
    text: async () => body,
    json: async () => JSON.parse(body)
  } as Response
}

describe('GoogleTranslator 429 classification (#703)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('classifies 429 dailyLimitExceeded as Quota exceeded', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(
        429,
        JSON.stringify({ error: { errors: [{ reason: 'dailyLimitExceeded' }] } })
      )
    )
    const t = new GoogleTranslator('key')
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Quota exceeded/)
  })

  it('classifies 429 quotaExceeded as Quota exceeded', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(429, JSON.stringify({ error: { errors: [{ reason: 'quotaExceeded' }] } }))
    )
    const t = new GoogleTranslator('key')
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Quota exceeded/)
  })

  it('classifies generic 429 as Rate limit', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(429, JSON.stringify({ error: { errors: [{ reason: 'rateLimitExceeded' }] } }))
    )
    const t = new GoogleTranslator('key')
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Rate limit/)
  })

  it('passes through 403 as invalid key', async () => {
    fetchMock.mockResolvedValue(makeResponse(403, ''))
    const t = new GoogleTranslator('bad')
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Invalid or expired API key/)
  })
})
