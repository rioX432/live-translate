import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { DeepLTranslator } from './DeepLTranslator'

function makeResponse(status: number, body: string, ok = status < 400): Response {
  return {
    ok,
    status,
    text: async () => body,
    json: async () => JSON.parse(body)
  } as Response
}

describe('DeepLTranslator 429 / 456 classification (#703)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('classifies 456 as Quota exceeded', async () => {
    fetchMock.mockResolvedValue(makeResponse(456, '{"message":"Quota for this billing period has been exceeded."}'))
    const t = new DeepLTranslator('key:fx')
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Quota exceeded/)
  })

  it('classifies 429 with quota body as Quota exceeded', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(429, '{"message":"Character limit reached for the current billing period"}')
    )
    const t = new DeepLTranslator('key:fx')
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Quota exceeded/)
  })

  it('classifies generic 429 as Rate limit', async () => {
    fetchMock.mockResolvedValue(makeResponse(429, '{"message":"Too many requests"}'))
    const t = new DeepLTranslator('key:fx')
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Rate limit/)
  })

  it('passes through 401 as invalid key', async () => {
    fetchMock.mockResolvedValue(makeResponse(401, ''))
    const t = new DeepLTranslator('bad:fx')
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Invalid or expired API key/)
  })
})
