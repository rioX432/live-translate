import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock DeepFilterNet3Core as a class since it requires browser APIs (AudioContext, WASM)
vi.mock('deepfilternet3-noise-filter', () => ({
  DeepFilterNet3Core: class MockDeepFilterNet3Core {
    initialize = vi.fn().mockResolvedValue(undefined)
    createAudioWorkletNode = vi.fn().mockResolvedValue({
      connect: vi.fn().mockReturnValue({ connect: vi.fn() }),
      disconnect: vi.fn()
    })
    setSuppressionLevel = vi.fn()
    setNoiseSuppressionEnabled = vi.fn()
    destroy = vi.fn()
    isReady = vi.fn().mockReturnValue(true)
  }
}))

describe('useNoiseSuppression module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('exports useNoiseSuppression hook', async () => {
    const mod = await import('./useNoiseSuppression')
    expect(mod.useNoiseSuppression).toBeDefined()
    expect(typeof mod.useNoiseSuppression).toBe('function')
  })

  it('DeepFilterNet3Core can be instantiated with config', async () => {
    const { DeepFilterNet3Core } = await import('deepfilternet3-noise-filter')
    const core = new DeepFilterNet3Core({
      sampleRate: 48000,
      noiseReductionLevel: 60
    })
    expect(core).toBeDefined()
    expect(core.initialize).toBeDefined()
    expect(core.createAudioWorkletNode).toBeDefined()
    expect(core.setSuppressionLevel).toBeDefined()
    expect(core.destroy).toBeDefined()
  })

  it('DeepFilterNet3Core initialize resolves without error', async () => {
    const { DeepFilterNet3Core } = await import('deepfilternet3-noise-filter')
    const core = new DeepFilterNet3Core({ sampleRate: 48000 })
    await expect(core.initialize()).resolves.toBeUndefined()
  })
})
