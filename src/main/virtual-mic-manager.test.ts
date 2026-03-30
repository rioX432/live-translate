import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock naudiodon before importing VirtualMicManager
const mockOutput = {
  start: vi.fn(),
  write: vi.fn().mockReturnValue(true),
  quit: vi.fn()
}

vi.mock('naudiodon', () => {
  const mockDevices = [
    { id: 0, name: 'Built-in Output', maxOutputChannels: 2, defaultSampleRate: 48000 },
    { id: 1, name: 'Built-in Microphone', maxOutputChannels: 0, defaultSampleRate: 48000 },
    { id: 2, name: 'BlackHole 2ch', maxOutputChannels: 2, defaultSampleRate: 48000 },
    { id: 3, name: 'Soundflower (2ch)', maxOutputChannels: 2, defaultSampleRate: 44100 },
    { id: 4, name: 'External Speakers', maxOutputChannels: 2, defaultSampleRate: 48000 }
  ]

  // AudioIO must be a real class so `new` works
  class MockAudioIO {
    constructor() {
      return mockOutput
    }
  }

  return {
    getDevices: vi.fn(() => mockDevices),
    AudioIO: MockAudioIO,
    SampleFormatFloat32: 1
  }
})

// Must import after mock setup
import { VirtualMicManager } from './virtual-mic-manager'

describe('VirtualMicManager', () => {
  let manager: VirtualMicManager

  beforeEach(async () => {
    vi.clearAllMocks()
    manager = new VirtualMicManager()
    await manager.initialize()
  })

  it('should detect available virtual devices', () => {
    const devices = manager.listVirtualDevices()
    expect(devices).toHaveLength(2) // BlackHole + Soundflower
    expect(devices[0]!.name).toBe('BlackHole 2ch')
    expect(devices[1]!.name).toBe('Soundflower (2ch)')
  })

  it('should not list non-virtual devices', () => {
    const devices = manager.listVirtualDevices()
    const names = devices.map((d) => d.name)
    expect(names).not.toContain('Built-in Output')
    expect(names).not.toContain('External Speakers')
  })

  it('should not list input-only devices', () => {
    const devices = manager.listVirtualDevices()
    const names = devices.map((d) => d.name)
    expect(names).not.toContain('Built-in Microphone')
  })

  it('should report available after initialization', () => {
    expect(manager.isAvailable()).toBe(true)
  })

  it('should enable output to a virtual device', async () => {
    await manager.enable(2) // BlackHole 2ch
    expect(manager.isEnabled()).toBe(true)

    const status = manager.getStatus()
    expect(status.enabled).toBe(true)
    expect(status.activeDeviceId).toBe(2)
    expect(status.activeDeviceName).toBe('BlackHole 2ch')
  })

  it('should disable output', async () => {
    await manager.enable(2)
    await manager.disable()

    expect(manager.isEnabled()).toBe(false)
    const status = manager.getStatus()
    expect(status.activeDeviceId).toBeNull()
  })

  it('should reject enabling for non-existent device', async () => {
    await expect(manager.enable(99)).rejects.toThrow('not found')
  })

  it('should reject enabling for input-only device', async () => {
    await expect(manager.enable(1)).rejects.toThrow('no output channels')
  })

  it('should write audio to the virtual device', async () => {
    await manager.enable(2)
    const audio = new Float32Array([0.1, 0.2, 0.3, 0.4])
    manager.writeAudio(audio, 48000)

    expect(mockOutput.write).toHaveBeenCalled()
  })

  it('should not write audio when disabled', () => {
    const audio = new Float32Array([0.1, 0.2, 0.3])
    // Should not throw
    manager.writeAudio(audio, 48000)
  })

  it('should not write empty audio', async () => {
    await manager.enable(2)
    manager.writeAudio(new Float32Array(0), 48000)

    expect(mockOutput.write).not.toHaveBeenCalled()
  })

  it('should dispose cleanly', async () => {
    await manager.enable(2)
    await manager.dispose()

    expect(manager.isEnabled()).toBe(false)
    expect(manager.isAvailable()).toBe(false)
  })

  it('should return correct status', () => {
    const status = manager.getStatus()
    expect(status.enabled).toBe(false)
    expect(status.activeDeviceId).toBeNull()
    expect(status.availableDevices.length).toBe(2)
  })
})
