import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { GeminiTranslator } from './GeminiTranslator'

function makeResponse(status: number, body: string, ok = status < 400): Response {
  return {
    ok,
    status,
    text: async () => body,
    json: async () => JSON.parse(body)
  } as Response
}

describe('GeminiTranslator 429 classification (#703)', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('classifies 429 daily quota exceeded as Quota exceeded', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(
        429,
        JSON.stringify({
          error: {
            message: 'Quota exceeded for quota metric "GenerateContent requests per day"',
            details: [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure' }]
          }
        })
      )
    )
    const t = new GeminiTranslator('key')
    await t.initialize()
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Quota exceeded/)
  })

  it('classifies generic per-minute 429 as Rate limit', async () => {
    fetchMock.mockResolvedValue(
      makeResponse(429, JSON.stringify({ error: { message: 'Too many requests' } }))
    )
    const t = new GeminiTranslator('key')
    await t.initialize()
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Rate limit/)
  })

  it('passes through 400 as invalid key', async () => {
    fetchMock.mockResolvedValue(makeResponse(400, ''))
    const t = new GeminiTranslator('bad')
    await t.initialize()
    await expect(t.translate('hi', 'en', 'ja')).rejects.toThrow(/Invalid API key/)
  })
})
