import { describe, it, expect, vi, beforeEach } from 'vitest'

const transcribe = vi.fn()
vi.mock('@kutalia/whisper-node-addon', () => ({ transcribe: (...args: unknown[]) => transcribe(...args) }))
vi.mock('../model-downloader', () => ({
  isModelDownloaded: () => true,
  getModelPath: () => '/models/ggml-large-v3-turbo.bin',
  downloadModel: vi.fn()
}))
vi.mock('../../main/logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
import { WhisperLocalEngine, mapWhisperLanguage } from './WhisperLocalEngine'

beforeEach(() => {
  transcribe.mockReset()
})

describe('mapWhisperLanguage', () => {
  it('accepts the codes the app supports and rejects the rest', () => {
    expect(mapWhisperLanguage('ja')).toBe('ja')
    expect(mapWhisperLanguage('en')).toBe('en')
    expect(mapWhisperLanguage('sw')).toBeNull()
    expect(mapWhisperLanguage(undefined)).toBeNull()
  })
})

describe('WhisperLocalEngine', () => {
  it('transcribes without translating and uses the language whisper detected', async () => {
    transcribe.mockResolvedValue({ transcription: ['今日はいい天気です'], language: 'ja' })
    const engine = new WhisperLocalEngine()
    await engine.initialize()
    const result = await engine.processAudio(new Float32Array(16_000), 16_000)

    expect(transcribe).toHaveBeenCalledWith(expect.objectContaining({
      model: '/models/ggml-large-v3-turbo.bin',
      language: 'auto',
      translate: false
    }))
    expect(result).toMatchObject({ text: '今日はいい天気です', language: 'ja', isFinal: true })
  })

  it('falls back to the script when whisper reports no supported language', async () => {
    transcribe.mockResolvedValue({ transcription: ['ありがとうございます、また明日'] })
    const engine = new WhisperLocalEngine()
    await engine.initialize()
    expect(await engine.processAudio(new Float32Array(16_000), 16_000)).toMatchObject({ language: 'ja' })
  })

  it('throws before initialize and after dispose', async () => {
    const engine = new WhisperLocalEngine()
    await expect(engine.processAudio(new Float32Array(10), 16_000)).rejects.toThrow('Not initialized')
    await engine.initialize()
    await engine.dispose()
    await expect(engine.processAudio(new Float32Array(10), 16_000)).rejects.toThrow('Not initialized')
  })

  it('waits for a transcription in flight before dispose resolves', async () => {
    let finish!: (value: unknown) => void
    transcribe.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const engine = new WhisperLocalEngine()
    await engine.initialize()
    const running = engine.processAudio(new Float32Array(16_000), 16_000)
    await Promise.resolve()

    let disposed = false
    const disposing = engine.dispose().then(() => { disposed = true })
    await new Promise((resolve) => setImmediate(resolve))
    expect(disposed).toBe(false)

    finish({ transcription: ['hello there'], language: 'en' })
    await running
    await disposing
    expect(disposed).toBe(true)
  })
})
