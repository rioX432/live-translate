import { useCallback, useEffect, useRef, useState } from 'react'
import { MicVAD } from '@ricky0123/vad-web'

export interface AudioDevice {
  deviceId: string
  label: string
}

export interface UseAudioCaptureReturn {
  devices: AudioDevice[]
  selectedDevice: string
  setSelectedDevice: (id: string) => void
  isCapturing: boolean
  volume: number // 0-1 for level meter
  permissionError: string | null // #48: mic permission error
  hasVirtualAudioDevice: boolean // #125: BlackHole/Soundflower detected
  start: () => Promise<void>
  stop: () => void
  /** Callback for VAD-detected complete speech segments (legacy mode). Returns unsubscribe function. */
  onAudioChunk: (callback: (chunk: Float32Array) => void) => () => void
  /** Callback for periodic rolling buffer during speech (streaming mode). Returns unsubscribe function. */
  onStreamingChunk: (callback: (buffer: Float32Array) => void) => () => void
  /** Callback when speech segment ends (streaming mode finalization). Returns unsubscribe function. */
  onSpeechSegmentEnd: (callback: (finalBuffer: Float32Array) => void) => () => void
}

/** Optional noise suppression preprocessor injected from the parent component */
export interface NoiseSuppressionProcessor {
  processStream: (stream: MediaStream) => Promise<MediaStream>
  destroy: () => Promise<void>
}

const DEFAULT_STREAMING_INTERVAL_MS = 1500
const SAMPLE_RATE = 16000
const MAX_ROLLING_BUFFER_SECONDS = 3
/** RMS threshold below which a frame is considered silence for trimming */
const SILENCE_RMS_THRESHOLD = 0.01

/**
 * Trim leading and trailing silence from audio buffer (#361).
 * Uses frame-level RMS analysis to find speech boundaries.
 * Keeps a small padding (160 samples = 10ms at 16kHz) around speech.
 */
function trimSilence(buffer: Float32Array): Float32Array | null {
  const frameSize = 160 // 10ms at 16kHz
  const padding = 160 // 10ms padding
  let firstSpeechSample = -1
  let lastSpeechSample = -1

  for (let i = 0; i < buffer.length; i += frameSize) {
    const end = Math.min(i + frameSize, buffer.length)
    let sum = 0
    for (let j = i; j < end; j++) {
      sum += buffer[j] * buffer[j]
    }
    const rms = Math.sqrt(sum / (end - i))
    if (rms > SILENCE_RMS_THRESHOLD) {
      if (firstSpeechSample === -1) firstSpeechSample = i
      lastSpeechSample = end
    }
  }

  if (firstSpeechSample === -1) return null // All silence

  const start = Math.max(0, firstSpeechSample - padding)
  const end = Math.min(buffer.length, lastSpeechSample + padding)
  const trimmedLength = end - start

  // Only trim if we save at least 20% of the audio
  if (trimmedLength >= buffer.length * 0.8) return buffer

  if (trimmedLength < SAMPLE_RATE * 0.3) return null // Too short after trimming
  return buffer.subarray(start, end)
}

export function useAudioCapture(noiseSuppression?: NoiseSuppressionProcessor): UseAudioCaptureReturn {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string>('')
  const [isCapturing, setIsCapturing] = useState(false)
  const [volume, setVolume] = useState(0)
  const [permissionError, setPermissionError] = useState<string | null>(null) // #48
  const [hasVirtualAudioDevice, setHasVirtualAudioDevice] = useState(false) // #125

  const vadRef = useRef<MicVAD | null>(null)
  const chunkCallbackRef = useRef<((chunk: Float32Array) => void) | null>(null)
  const streamingCallbackRef = useRef<((buffer: Float32Array) => void) | null>(null)
  const speechEndCallbackRef = useRef<((finalBuffer: Float32Array) => void) | null>(null)

  // Rolling buffer state for streaming (#53: use circular buffer)
  const isSpeakingRef = useRef(false)
  const rollingBufferRef = useRef<Float32Array[]>([])
  const rollingBufferIndexRef = useRef(0)
  const rollingBufferFullRef = useRef(false)
  const streamingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Enumerate audio input devices
  useEffect(() => {
    const enumerate = async (): Promise<void> => {
      try {
        // Request permission first to get device labels
        await navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
          s.getTracks().forEach((t) => t.stop())
        })
        const allDevices = await navigator.mediaDevices.enumerateDevices()
        const audioInputs = allDevices
          .filter((d) => d.kind === 'audioinput')
          .map((d) => ({ deviceId: d.deviceId, label: d.label || `Microphone ${d.deviceId.slice(0, 6)}` }))
        setDevices(audioInputs)
        // #125/#243: Detect virtual audio devices (macOS: BlackHole/Soundflower, Windows: Stereo Mix/VB-Audio)
        const virtualKeywords = ['blackhole', 'soundflower', 'loopback', 'virtual', 'stereo mix', 'vb-audio', 'voicemeeter']
        const hasVirtual = audioInputs.some((d) =>
          virtualKeywords.some((kw) => d.label.toLowerCase().includes(kw))
        )
        setHasVirtualAudioDevice(hasVirtual)
        if (audioInputs.length > 0 && !selectedDevice) {
          setSelectedDevice(audioInputs[0].deviceId)
        }
      } catch (err) {
        console.error('Failed to enumerate audio devices:', err)
        // #48: surface permission errors to UI with specific messages
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('NotAllowedError') || message.includes('Permission')) {
          setPermissionError('Microphone access denied. Please grant permission in System Settings > Privacy & Security > Microphone.')
        } else if (message.includes('NotFoundError') || message.includes('DevicesNotFoundError')) {
          setPermissionError('No microphone detected. Please connect a microphone and restart.')
        } else if (message.includes('NotReadableError') || message.includes('TrackStartError')) {
          setPermissionError('Microphone is in use by another application. Please close the other app and try again.')
        } else {
          setPermissionError(`Microphone error: ${message}`)
        }
      }
    }
    enumerate()
  }, [])

  const getRollingBuffer = useCallback((): Float32Array | null => {
    const frames = rollingBufferRef.current
    const index = rollingBufferIndexRef.current
    const isFull = rollingBufferFullRef.current
    const count = isFull ? frames.length : index
    if (count === 0) return null

    // Reconstruct buffer in correct order from circular buffer
    const orderedFrames = isFull
      ? [...frames.slice(index), ...frames.slice(0, index)]
      : frames.slice(0, index)

    const totalLength = orderedFrames.reduce((sum, f) => sum + f.length, 0)
    if (totalLength < SAMPLE_RATE * 0.5) return null // Need at least 0.5s
    const buffer = new Float32Array(totalLength)
    let offset = 0
    for (const frame of orderedFrames) {
      buffer.set(frame, offset)
      offset += frame.length
    }

    // #361: Trim leading/trailing silence to reduce audio sent to Whisper
    return trimSilence(buffer)
  }, [])

  const startStreamingTimer = useCallback(() => {
    if (streamingTimerRef.current) return
    streamingTimerRef.current = setInterval(() => {
      if (!isSpeakingRef.current) return
      const buffer = getRollingBuffer()
      if (buffer) {
        console.log(`[audio-capture] Streaming chunk: ${buffer.length} samples (${(buffer.length / SAMPLE_RATE).toFixed(1)}s)`)
        streamingCallbackRef.current?.(buffer)
      }
    }, DEFAULT_STREAMING_INTERVAL_MS)
  }, [getRollingBuffer])

  const stopStreamingTimer = useCallback(() => {
    if (streamingTimerRef.current) {
      clearInterval(streamingTimerRef.current)
      streamingTimerRef.current = null
    }
  }, [])

  const start = useCallback(async () => {
    if (isCapturing) return

    const deviceId = selectedDevice
    const vad = await MicVAD.new({
      getStream: async () => {
        // #313: Request 48 kHz when DeepFilterNet3 is active (it requires 48 kHz);
        // VAD resamples internally to 16 kHz regardless.
        const idealSampleRate = noiseSuppression ? 48000 : 16000
        const rawStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            channelCount: 1,
            sampleRate: { ideal: idealSampleRate },
            echoCancellation: true,
            noiseSuppression: !noiseSuppression // disable browser NS when DeepFilterNet3 is active
          }
        })
        // #313: Apply DeepFilterNet3 noise suppression before VAD
        if (noiseSuppression) {
          return noiseSuppression.processStream(rawStream)
        }
        return rawStream
      },
      // Override with more sensitive thresholds for real-time translation
      positiveSpeechThreshold: 0.25,
      negativeSpeechThreshold: 0.1,
      redemptionMs: 800,
      minSpeechMs: 250,
      // AudioWorklet runs audio processing off the main thread (replaces deprecated ScriptProcessor)
      processorType: 'AudioWorklet',
      // Serve ONNX model and WASM from public/vad/
      baseAssetPath: '/vad/',
      onnxWASMBasePath: '/vad/',
      onFrameProcessed: (_probs, frame) => {
        // Volume meter (RMS) from each frame
        let sum = 0
        for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
        const rms = Math.sqrt(sum / frame.length)
        setVolume(Math.min(1, rms * 5))

        // #53: accumulate frames in circular buffer during speech (#361: reduced from 5s to 3s)
        if (isSpeakingRef.current) {
          const maxFrames = Math.floor((MAX_ROLLING_BUFFER_SECONDS * SAMPLE_RATE) / frame.length)
          const buf = rollingBufferRef.current
          if (buf.length < maxFrames && !rollingBufferFullRef.current) {
            buf.push(new Float32Array(frame))
            rollingBufferIndexRef.current = buf.length
          } else {
            // Circular overwrite — no allocation, no slice
            if (buf.length < maxFrames) {
              buf.length = maxFrames
            }
            rollingBufferFullRef.current = true
            const idx = rollingBufferIndexRef.current % maxFrames
            buf[idx] = new Float32Array(frame)
            rollingBufferIndexRef.current = (idx + 1) % maxFrames
          }
        }
      },
      onSpeechEnd: (audio: Float32Array) => {
        // audio is 16kHz Float32Array from VAD
        console.log(`[audio-capture] VAD speech segment: ${audio.length} samples (${(audio.length / SAMPLE_RATE).toFixed(1)}s)`)

        // Finalize streaming with the VAD-provided segment
        isSpeakingRef.current = false
        speechEndCallbackRef.current?.(audio)
        rollingBufferRef.current = []
        rollingBufferIndexRef.current = 0
        rollingBufferFullRef.current = false

        // Also fire legacy callback
        chunkCallbackRef.current?.(audio)
      },
      onSpeechStart: () => {
        console.log('[audio-capture] VAD speech start')
        isSpeakingRef.current = true
        rollingBufferRef.current = []
        rollingBufferIndexRef.current = 0
        rollingBufferFullRef.current = false
      },
      onVADMisfire: () => {
        console.log('[audio-capture] VAD misfire (speech too short)')
        isSpeakingRef.current = false
        rollingBufferRef.current = []
        rollingBufferIndexRef.current = 0
        rollingBufferFullRef.current = false
      }
    })

    vadRef.current = vad
    vad.start()
    startStreamingTimer()
    setIsCapturing(true)
    console.log('[audio-capture] VAD started with streaming')
  }, [selectedDevice, isCapturing, startStreamingTimer])

  const stop = useCallback(() => {
    stopStreamingTimer()
    if (vadRef.current) {
      vadRef.current.destroy()
      vadRef.current = null
    }
    // #313: Release DeepFilterNet3 resources
    noiseSuppression?.destroy().catch((err) => console.warn('[audio-capture] Noise suppression cleanup error:', err))
    isSpeakingRef.current = false
    rollingBufferRef.current = []
    rollingBufferIndexRef.current = 0
    rollingBufferFullRef.current = false
    setIsCapturing(false)
    setVolume(0)
    console.log('[audio-capture] VAD stopped')
  }, [stopStreamingTimer, noiseSuppression])

  const onAudioChunk = useCallback((callback: (chunk: Float32Array) => void) => {
    chunkCallbackRef.current = callback
    return () => { chunkCallbackRef.current = null }
  }, [])

  const onStreamingChunk = useCallback((callback: (buffer: Float32Array) => void) => {
    streamingCallbackRef.current = callback
    return () => { streamingCallbackRef.current = null }
  }, [])

  const onSpeechSegmentEnd = useCallback((callback: (finalBuffer: Float32Array) => void) => {
    speechEndCallbackRef.current = callback
    return () => { speechEndCallbackRef.current = null }
  }, [])

  return {
    devices,
    selectedDevice,
    setSelectedDevice,
    isCapturing,
    volume,
    permissionError,
    hasVirtualAudioDevice,
    start,
    stop,
    onAudioChunk,
    onStreamingChunk,
    onSpeechSegmentEnd
  }
}
