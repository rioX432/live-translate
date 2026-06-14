/**
 * Unit tests for the Realtime transcription client helpers.
 */
import { describe, it, expect } from 'vitest'

import { buildSessionUpdate, transcribeOnce } from './realtime-client'

describe('buildSessionUpdate', () => {
  it('uses the documented schema for gpt-realtime-whisper', () => {
    const payload = buildSessionUpdate('ja', 'low') as {
      type: string
      session: {
        type: string
        audio: {
          input: {
            format: { type: string; rate: number }
            transcription: { model: string; language?: string; delay: string }
            turn_detection: null
          }
        }
      }
    }
    expect(payload.type).toBe('session.update')
    expect(payload.session.type).toBe('transcription')
    expect(payload.session.audio.input.format.type).toBe('audio/pcm')
    expect(payload.session.audio.input.format.rate).toBe(24_000)
    expect(payload.session.audio.input.transcription.model).toBe('gpt-realtime-whisper')
    expect(payload.session.audio.input.transcription.language).toBe('ja')
    expect(payload.session.audio.input.transcription.delay).toBe('low')
    expect(payload.session.audio.input.turn_detection).toBeNull()
  })

  it('omits language when no hint is provided', () => {
    const payload = buildSessionUpdate(undefined, 'medium') as {
      session: { audio: { input: { transcription: Record<string, unknown> } } }
    }
    const transcription = payload.session.audio.input.transcription
    expect('language' in transcription).toBe(false)
    expect(transcription.delay).toBe('medium')
  })
})

describe('transcribeOnce', () => {
  it('rejects when API key is missing', async () => {
    await expect(
      transcribeOnce({
        apiKey: '',
        pcm16At24kHz: Buffer.alloc(0)
      })
    ).rejects.toThrow(/OPENAI_API_KEY is required/)
  })
})
