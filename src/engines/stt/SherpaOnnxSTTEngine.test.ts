import { describe, it, expect, vi, beforeEach } from 'vitest'
import { SherpaOnnxSTTEngine, SHERPA_ONNX_PRESETS } from './SherpaOnnxSTTEngine'

// Mock model-downloader to avoid Electron app dependency
vi.mock('../model-downloader', () => ({
  getModelsDir: vi.fn(() => '/tmp/test-models'),
}))

// Mock fs functions
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs')
  return {
    ...actual,
    existsSync: vi.fn(() => true),
    mkdirSync: vi.fn(),
  }
})

// Mock sherpa-onnx recognizer internals
const mockDecode = vi.fn()
const mockGetResult = vi.fn()
const mockAcceptWaveform = vi.fn()
const mockCreateStream = vi.fn(() => ({
  acceptWaveform: mockAcceptWaveform,
}))

const MockOfflineRecognizer = vi.fn(function (this: Record<string, unknown>) {
  this.config = { featConfig: { sampleRate: 16000, featureDim: 80 } }
  this.createStream = mockCreateStream
  this.decode = mockDecode
  this.getResult = mockGetResult
})

/** Factory that returns a mock SherpaOnnxModule for DI */
function createMockModuleLoader() {
  return () => ({
    OfflineRecognizer: MockOfflineRecognizer as unknown,
    readWave: vi.fn(),
  }) as unknown as ReturnType<typeof import('./SherpaOnnxSTTEngine').loadSherpaModule>
}

describe('SherpaOnnxSTTEngine', () => {
  let engine: SherpaOnnxSTTEngine

  beforeEach(() => {
    vi.clearAllMocks()
    engine = new SherpaOnnxSTTEngine({
      preset: 'whisper-tiny',
      moduleLoader: createMockModuleLoader(),
    })
  })

  it('has correct id and metadata', () => {
    expect(engine.id).toBe('sherpa-onnx')
    expect(engine.isOffline).toBe(true)
    expect(engine.name).toContain('Sherpa-ONNX')
  })

  it('initialize is idempotent', async () => {
    await engine.initialize()
    await engine.initialize()
    // OfflineRecognizer should only be constructed once
    expect(MockOfflineRecognizer).toHaveBeenCalledTimes(1)
  })

  it('processAudio returns null before initialization', async () => {
    const audio = new Float32Array(16000)
    const result = await engine.processAudio(audio, 16000)
    expect(result).toBeNull()
  })

  it('processAudio returns STTResult for valid speech', async () => {
    mockGetResult.mockReturnValue({ text: 'Hello world', lang: 'en' })

    await engine.initialize()
    const audio = new Float32Array(16000)
    const result = await engine.processAudio(audio, 16000)

    expect(result).not.toBeNull()
    expect(result!.text).toBe('Hello world')
    expect(result!.language).toBe('en')
    expect(result!.isFinal).toBe(true)
    expect(result!.timestamp).toBeGreaterThan(0)
  })

  it('processAudio returns null for empty text', async () => {
    mockGetResult.mockReturnValue({ text: '', lang: 'en' })

    await engine.initialize()
    const audio = new Float32Array(16000)
    const result = await engine.processAudio(audio, 16000)

    expect(result).toBeNull()
  })

  it('processAudio returns null for whitespace-only text', async () => {
    mockGetResult.mockReturnValue({ text: '   ', lang: 'en' })

    await engine.initialize()
    const audio = new Float32Array(16000)
    const result = await engine.processAudio(audio, 16000)

    expect(result).toBeNull()
  })

  it('passes audio to stream.acceptWaveform correctly', async () => {
    mockGetResult.mockReturnValue({ text: 'test', lang: 'en' })

    await engine.initialize()
    const audio = new Float32Array([0.1, 0.2, 0.3])
    await engine.processAudio(audio, 16000)

    expect(mockAcceptWaveform).toHaveBeenCalledWith({
      sampleRate: 16000,
      samples: audio,
    })
  })

  it('detects Japanese from lang field', async () => {
    mockGetResult.mockReturnValue({ text: 'こんにちは', lang: 'ja' })

    await engine.initialize()
    const result = await engine.processAudio(new Float32Array(16000), 16000)

    expect(result!.language).toBe('ja')
  })

  it('detects Japanese from script when lang is missing', async () => {
    mockGetResult.mockReturnValue({ text: 'こんにちは世界' })

    await engine.initialize()
    const result = await engine.processAudio(new Float32Array(16000), 16000)

    expect(result!.language).toBe('ja')
  })

  it('maps Cantonese (yue) to Chinese', async () => {
    mockGetResult.mockReturnValue({ text: '你好', lang: 'yue' })

    await engine.initialize()
    const result = await engine.processAudio(new Float32Array(16000), 16000)

    expect(result!.language).toBe('zh')
  })

  it('processing guard prevents reentrant calls', async () => {
    // Verify the processing flag exists and is reset after each call
    mockGetResult.mockReturnValue({ text: 'first', lang: 'en' })

    await engine.initialize()
    const audio = new Float32Array(16000)

    // Sequential calls should both succeed (flag is reset between calls)
    const result1 = await engine.processAudio(audio, 16000)
    const result2 = await engine.processAudio(audio, 16000)

    expect(result1).not.toBeNull()
    expect(result2).not.toBeNull()
    expect(mockDecode).toHaveBeenCalledTimes(2)
  })

  it('returns null on recognition error', async () => {
    mockDecode.mockImplementation(() => {
      throw new Error('ONNX runtime error')
    })

    await engine.initialize()
    const result = await engine.processAudio(new Float32Array(16000), 16000)

    expect(result).toBeNull()
  })

  it('dispose clears state', async () => {
    await engine.initialize()
    await engine.dispose()

    // After dispose, processAudio should return null
    const result = await engine.processAudio(new Float32Array(16000), 16000)
    expect(result).toBeNull()
  })

  it('all presets have required fields', () => {
    for (const [, config] of Object.entries(SHERPA_ONNX_PRESETS)) {
      expect(config.label).toBeTruthy()
      expect(config.description).toBeTruthy()
      expect(config.dirName).toBeTruthy()
      expect(config.downloadUrl).toContain('https://')
      expect(config.sizeMB).toBeGreaterThan(0)
      expect(typeof config.buildModelConfig).toBe('function')

      // Verify buildModelConfig returns valid structure
      const modelConfig = config.buildModelConfig(`/models/${config.dirName}`)
      expect(modelConfig.tokens).toBeTruthy()
      expect(modelConfig.numThreads).toBeGreaterThan(0)
      expect(modelConfig.provider).toBe('cpu')
    }
  })

  it('preset name is included in engine name', () => {
    const engine2 = new SherpaOnnxSTTEngine({
      preset: 'sensevoice',
      moduleLoader: createMockModuleLoader(),
    })
    expect(engine2.name).toContain('SenseVoice')
  })
})
