import { createLogger } from './logger'

const log = createLogger('virtual-mic')

/**
 * Known virtual audio device name patterns.
 * These are matched case-insensitively against device names from PortAudio.
 */
const VIRTUAL_DEVICE_PATTERNS = [
  'blackhole',
  'soundflower',
  'loopback',
  'virtual cable',
  'vb-cable',
  'roc virtual',
  'existential audio'
]

/** Minimal device info returned by PortAudio via naudiodon */
interface PortAudioDevice {
  id: number
  name: string
  maxOutputChannels: number
  defaultSampleRate: number
  hostAPIName?: string
}

/** Public device info exposed to renderer */
export interface VirtualMicDevice {
  id: number
  name: string
  maxOutputChannels: number
  defaultSampleRate: number
}

/** Status of the virtual mic subsystem */
export interface VirtualMicStatus {
  enabled: boolean
  activeDeviceId: number | null
  activeDeviceName: string | null
  availableDevices: VirtualMicDevice[]
}

/**
 * Manages routing TTS audio to a virtual audio device (e.g. BlackHole)
 * so that meeting apps (Zoom, Teams, Meet) can capture the translated speech.
 *
 * Uses naudiodon (PortAudio bindings) to write PCM audio to a specific output device.
 * The user must install a virtual audio driver (e.g. BlackHole) separately.
 */
export class VirtualMicManager {
  private enabled = false
  private activeDeviceId: number | null = null
  private activeDeviceName: string | null = null
  private portAudio: PortAudioModule | null = null
  private audioOutput: PortAudioOutput | null = null

  // Target audio format for the virtual mic output
  private readonly targetSampleRate = 48000
  private readonly targetChannels = 1

  /**
   * Initialize the manager — attempts to load naudiodon.
   * Does not throw if naudiodon is unavailable; the feature is simply disabled.
   */
  async initialize(): Promise<void> {
    // naudiodon's PortAudio backend crashes with SIGSEGV in getDevices() on
    // macOS 26+ (Tahoe) due to incompatible PortAudio host API changes.
    // Skip loading entirely on affected versions to prevent app crash at startup.
    if (process.platform === 'darwin') {
      const majorVersion = Number(require('os').release().split('.')[0])
      // Darwin 25.x = macOS 26 (Tahoe)
      if (majorVersion >= 25) {
        log.warn(`naudiodon skipped — PortAudio crashes on macOS 26+ (Darwin ${majorVersion})`)
        this.portAudio = null
        return
      }
    }

    try {
      // Dynamic import to avoid hard dependency — naudiodon may not be installed
      this.portAudio = await import('naudiodon') as unknown as PortAudioModule
      log.info('PortAudio (naudiodon) loaded successfully')
    } catch (err) {
      log.warn('naudiodon not available — virtual mic feature disabled:', err)
      this.portAudio = null
    }
  }

  /** Check if the PortAudio backend is available */
  isAvailable(): boolean {
    return this.portAudio !== null
  }

  /** Check if virtual mic output is currently enabled and streaming */
  isEnabled(): boolean {
    return this.enabled && this.audioOutput !== null
  }

  /**
   * List all detected virtual audio output devices.
   * Filters PortAudio devices by known virtual driver name patterns.
   */
  listVirtualDevices(): VirtualMicDevice[] {
    if (!this.portAudio) return []

    try {
      const allDevices: PortAudioDevice[] = this.portAudio.getDevices()
      return allDevices
        .filter((d) => d.maxOutputChannels > 0 && isVirtualDevice(d.name))
        .map((d) => ({
          id: d.id,
          name: d.name,
          maxOutputChannels: d.maxOutputChannels,
          defaultSampleRate: d.defaultSampleRate
        }))
    } catch (err) {
      log.error('Failed to enumerate audio devices:', err)
      return []
    }
  }

  /**
   * Enable virtual mic output to the specified device.
   * Creates a PortAudio output stream targeting the virtual device.
   */
  async enable(deviceId: number): Promise<void> {
    if (!this.portAudio) {
      throw new Error('PortAudio (naudiodon) is not available. Install naudiodon to use virtual mic.')
    }

    // Verify the device exists
    const devices: PortAudioDevice[] = this.portAudio.getDevices()
    const device = devices.find((d) => d.id === deviceId)
    if (!device) {
      throw new Error(`Audio device with ID ${deviceId} not found`)
    }
    if (device.maxOutputChannels < 1) {
      throw new Error(`Device "${device.name}" has no output channels`)
    }

    // Close existing output if any
    await this.disable()

    try {
      // Use the device's default sample rate to avoid resampling at the driver level
      const sampleRate = device.defaultSampleRate || this.targetSampleRate

      this.audioOutput = new this.portAudio.AudioIO({
        outOptions: {
          channelCount: this.targetChannels,
          sampleFormat: this.portAudio.SampleFormatFloat32,
          sampleRate,
          deviceId: device.id,
          closeOnError: false
        }
      }) as PortAudioOutput

      this.audioOutput.start()
      this.activeDeviceId = device.id
      this.activeDeviceName = device.name
      this.enabled = true

      log.info(`Virtual mic enabled: "${device.name}" (id=${device.id}, rate=${sampleRate})`)
    } catch (err) {
      this.audioOutput = null
      this.activeDeviceId = null
      this.activeDeviceName = null
      this.enabled = false
      log.error('Failed to open virtual mic device:', err)
      throw err
    }
  }

  /** Disable virtual mic output and close the PortAudio stream */
  async disable(): Promise<void> {
    if (this.audioOutput) {
      try {
        this.audioOutput.quit()
      } catch (err) {
        log.warn('Error closing virtual mic stream:', err)
      }
      this.audioOutput = null
    }
    this.activeDeviceId = null
    this.activeDeviceName = null
    this.enabled = false
    log.info('Virtual mic disabled')
  }

  /**
   * Write TTS audio to the virtual mic device.
   * Handles sample rate conversion if needed.
   *
   * @param audio PCM float32 audio samples (mono)
   * @param sampleRate Source sample rate (e.g. 24000 from Kokoro TTS)
   */
  writeAudio(audio: Float32Array, sampleRate: number): void {
    if (!this.enabled || !this.audioOutput) return
    if (audio.length === 0) return

    try {
      // Resample if source sample rate differs from device sample rate
      const deviceRate = this.getActiveSampleRate()
      const resampled = sampleRate !== deviceRate
        ? resampleLinear(audio, sampleRate, deviceRate)
        : audio

      // Convert Float32Array to Buffer for naudiodon WritableStream
      const buffer = Buffer.from(resampled.buffer, resampled.byteOffset, resampled.byteLength)
      this.audioOutput.write(buffer)
    } catch (err) {
      log.error('Failed to write audio to virtual mic:', err)
    }
  }

  /** Get the current status of the virtual mic subsystem */
  getStatus(): VirtualMicStatus {
    return {
      enabled: this.enabled,
      activeDeviceId: this.activeDeviceId,
      activeDeviceName: this.activeDeviceName,
      availableDevices: this.listVirtualDevices()
    }
  }

  /** Get the sample rate of the active device, or default */
  private getActiveSampleRate(): number {
    if (!this.portAudio || this.activeDeviceId === null) return this.targetSampleRate
    try {
      const devices: PortAudioDevice[] = this.portAudio.getDevices()
      const device = devices.find((d) => d.id === this.activeDeviceId)
      return device?.defaultSampleRate || this.targetSampleRate
    } catch {
      return this.targetSampleRate
    }
  }

  /** Release all resources */
  async dispose(): Promise<void> {
    await this.disable()
    this.portAudio = null
    log.info('VirtualMicManager disposed')
  }
}

/**
 * Check if a device name matches known virtual audio device patterns.
 */
function isVirtualDevice(name: string): boolean {
  const lower = name.toLowerCase()
  return VIRTUAL_DEVICE_PATTERNS.some((pattern) => lower.includes(pattern))
}

/**
 * Simple linear interpolation resampler.
 * Converts audio from one sample rate to another.
 * Suitable for non-critical TTS output where perfect quality is not required.
 */
function resampleLinear(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return input

  const ratio = fromRate / toRate
  const outputLength = Math.round(input.length / ratio)
  const output = new Float32Array(outputLength)

  for (let i = 0; i < outputLength; i++) {
    const srcIdx = i * ratio
    const idx = Math.floor(srcIdx)
    const frac = srcIdx - idx

    if (idx + 1 < input.length) {
      output[i] = input[idx]! * (1 - frac) + input[idx + 1]! * frac
    } else {
      output[i] = input[Math.min(idx, input.length - 1)]!
    }
  }

  return output
}

// --- Minimal type definitions for naudiodon ---

interface PortAudioModule {
  getDevices(): PortAudioDevice[]
  AudioIO: new (options: { outOptions: PortAudioOutOptions }) => PortAudioOutput
  SampleFormatFloat32: number
}

interface PortAudioOutOptions {
  channelCount: number
  sampleFormat: number
  sampleRate: number
  deviceId: number
  closeOnError: boolean
}

interface PortAudioOutput {
  start(): void
  write(buffer: Buffer): boolean
  quit(): void
}
