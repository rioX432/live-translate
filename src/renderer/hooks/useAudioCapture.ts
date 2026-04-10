import { useCallback, useEffect, useRef, useState } from 'react'
import { MicVAD } from '@ricky0123/vad-web'

export interface AudioDevice {
  deviceId: string
  label: string
}

/** Audio source mode: microphone only, system audio (loopback), or both mixed (#501) */
export type AudioSource = 'microphone' | 'system' | 'both'

export interface UseAudioCaptureReturn {
  devices: AudioDevice[]
  selectedDevice: string
  setSelectedDevice: (id: string) => void
  audioSource: AudioSource
  setAudioSource: (source: AudioSource) => void
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

const DEFAULT_STREAMING_INTERVAL_MS = 1000
const SAMPLE_RATE = 16000
const MAX_ROLLING_BUFFER_SECONDS = 3
/** Overlap from previous chunk to prevent word boundary cutting (200ms at 16kHz) */
const CHUNK_OVERLAP_SAMPLES = Math.floor(SAMPLE_RATE * 0.2)
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

export function useAudioCapture(noiseSuppression?: NoiseSuppressionProcessor, streamingIntervalMs?: number): UseAudioCaptureReturn {
  const effectiveInterval = streamingIntervalMs != null
    ? Math.max(500, Math.min(3000, streamingIntervalMs))
    : DEFAULT_STREAMING_INTERVAL_MS
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string>('')
  const [audioSource, setAudioSource] = useState<AudioSource>('microphone')
  const [isCapturing, setIsCapturing] = useState(false)
  const [volume, setVolume] = useState(0)
  const [permissionError, setPermissionError] = useState<string | null>(null) // #48
  const [hasVirtualAudioDevice, setHasVirtualAudioDevice] = useState(false) // #125

  const vadRef = useRef<MicVAD | null>(null)
  const chunkCallbackRef = useRef<((chunk: Float32Array) => void) | null>(null)
  const streamingCallbackRef = useRef<((buffer: Float32Array) => void) | null>(null)
  const speechEndCallbackRef = useRef<((finalBuffer: Float32Array) => void) | null>(null)

  // #501: Track loopback and mixer resources for cleanup
  const loopbackStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  // Rolling buffer state for streaming (#53: use circular buffer)
  const isSpeakingRef = useRef(false)
  const rollingBufferRef = useRef<Float32Array[]>([])
  const rollingBufferIndexRef = useRef(0)
  const rollingBufferFullRef = useRef(false)
  const streamingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Previous chunk tail for overlap to prevent word boundary cutting (#506)
  const prevChunkTailRef = useRef<Float32Array | null>(null)

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
          // Platform-specific permission guidance
          const permissionHint = navigator.userAgent.includes('Windows')
            ? 'Please grant permission in Windows Settings > Privacy > Microphone.'
            : 'Please grant permission in System Settings > Privacy & Security > Microphone.'
          setPermissionError(`Microphone access denied. ${permissionHint}`)
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
        // Prepend overlap from previous chunk tail to prevent word boundary cutting (#506)
        let output: Float32Array
        const tail = prevChunkTailRef.current
        if (tail && tail.length > 0) {
          output = new Float32Array(tail.length + buffer.length)
          output.set(tail, 0)
          output.set(buffer, tail.length)
        } else {
          output = buffer
        }
        // Save tail of current chunk for next overlap
        if (buffer.length > CHUNK_OVERLAP_SAMPLES) {
          prevChunkTailRef.current = buffer.slice(buffer.length - CHUNK_OVERLAP_SAMPLES)
        } else {
          prevChunkTailRef.current = new Float32Array(buffer)
        }
        console.log(`[audio-capture] Streaming chunk: ${output.length} samples (${(output.length / SAMPLE_RATE).toFixed(1)}s)`)
        streamingCallbackRef.current?.(output)
      }
    }, effectiveInterval)
  }, [getRollingBuffer, effectiveInterval])

  const stopStreamingTimer = useCallback(() => {
    if (streamingTimerRef.current) {
      clearInterval(streamingTimerRef.current)
      streamingTimerRef.current = null
    }
  }, [])

  // Consolidated cleanup for loopback stream, AudioContext, and rolling buffer refs
  const cleanupResources = useCallback(() => {
    if (loopbackStreamRef.current) {
      loopbackStreamRef.current.getTracks().forEach((t) => t.stop())
      loopbackStreamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch((err) => console.warn('[audio-capture] AudioContext close error:', err))
      audioContextRef.current = null
    }
    isSpeakingRef.current = false
    rollingBufferRef.current = []
    rollingBufferIndexRef.current = 0
    rollingBufferFullRef.current = false
    prevChunkTailRef.current = null
  }, [])

  // #501: Acquire system audio loopback stream via electron-audio-loopback
  const getLoopbackStream = useCallback(async (): Promise<MediaStream> => {
    // Enable loopback audio in the main process (registers desktopCapturer handler)
    await window.api.enableLoopbackAudio()
    try {
      // getDisplayMedia captures system audio; video track is required by the API
      // but we discard it immediately to avoid wasting resources
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      })
      // Remove video tracks — only audio is needed
      for (const track of stream.getVideoTracks()) {
        track.stop()
        stream.removeTrack(track)
      }
      return stream
    } finally {
      // Disable loopback capture handler after stream is acquired
      await window.api.disableLoopbackAudio()
    }
  }, [])

  // #501: Mix two MediaStreams into one using Web Audio API
  const mixStreams = useCallback((micStream: MediaStream, loopbackStream: MediaStream): MediaStream => {
    const ctx = new AudioContext({ sampleRate: 16000 })
    audioContextRef.current = ctx
    const dest = ctx.createMediaStreamDestination()

    const micSource = ctx.createMediaStreamSource(micStream)
    const loopbackSource = ctx.createMediaStreamSource(loopbackStream)

    micSource.connect(dest)
    loopbackSource.connect(dest)

    return dest.stream
  }, [])

  const start = useCallback(async () => {
    if (isCapturing) return

    try {
      const deviceId = selectedDevice
      const currentAudioSource = audioSource
      const vad = await MicVAD.new({
        getStream: async () => {
          // #313: Request 48 kHz when DeepFilterNet3 is active (it requires 48 kHz);
          // VAD resamples internally to 16 kHz regardless.
          const idealSampleRate = noiseSuppression ? 48000 : 16000

          // #501: Get the appropriate stream based on audio source setting
          if (currentAudioSource === 'system') {
            // System audio only — no microphone
            const loopback = await getLoopbackStream()
            loopbackStreamRef.current = loopback
            console.log('[audio-capture] Using system audio loopback')
            return loopback
          }

          // Get microphone stream (used for 'microphone' and 'both' modes)
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
          const micStream = noiseSuppression
            ? await noiseSuppression.processStream(rawStream)
            : rawStream

          if (currentAudioSource === 'both') {
            // #501: Mix microphone + system audio loopback
            const loopback = await getLoopbackStream()
            loopbackStreamRef.current = loopback
            console.log('[audio-capture] Using mixed microphone + system audio')
            return mixStreams(micStream, loopback)
          }

          // Microphone only (default)
          return micStream
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
          prevChunkTailRef.current = null

          // Also fire legacy callback
          chunkCallbackRef.current?.(audio)
        },
        onSpeechStart: () => {
          console.log('[audio-capture] VAD speech start')
          isSpeakingRef.current = true
          rollingBufferRef.current = []
          rollingBufferIndexRef.current = 0
          rollingBufferFullRef.current = false
          prevChunkTailRef.current = null
        },
        onVADMisfire: () => {
          console.log('[audio-capture] VAD misfire (speech too short)')
          isSpeakingRef.current = false
          rollingBufferRef.current = []
          rollingBufferIndexRef.current = 0
          rollingBufferFullRef.current = false
          prevChunkTailRef.current = null
        }
      })

      vadRef.current = vad
      vad.start()
      startStreamingTimer()
      setIsCapturing(true)
      console.log('[audio-capture] VAD started with streaming')
    } catch (err) {
      // #381: Clean up streaming timer and VAD if start fails partway through
      console.error('[audio-capture] Failed to start:', err)
      stopStreamingTimer()
      if (vadRef.current) {
        vadRef.current.destroy()
        vadRef.current = null
      }
      // #501: Clean up loopback resources on failed start
      cleanupResources()
      setIsCapturing(false)
      throw err
    }
  }, [selectedDevice, audioSource, isCapturing, startStreamingTimer, stopStreamingTimer, getLoopbackStream, mixStreams, cleanupResources])

  const stop = useCallback(() => {
    stopStreamingTimer()
    if (vadRef.current) {
      vadRef.current.destroy()
      vadRef.current = null
    }
    // #501: Release loopback stream and audio mixer resources
    cleanupResources()
    // #313: Release DeepFilterNet3 resources
    noiseSuppression?.destroy().catch((err) => console.warn('[audio-capture] Noise suppression cleanup error:', err))
    setIsCapturing(false)
    setVolume(0)
    console.log('[audio-capture] VAD stopped')
  }, [stopStreamingTimer, noiseSuppression, cleanupResources])

  // #443: Safety net — clear streaming timer, VAD, and loopback on unmount if stop() was not called
  useEffect(() => {
    return () => {
      if (streamingTimerRef.current) {
        clearInterval(streamingTimerRef.current)
        streamingTimerRef.current = null
      }
      if (vadRef.current) {
        vadRef.current.destroy()
        vadRef.current = null
      }
      // #501: Release loopback resources on unmount
      cleanupResources()
    }
  }, [cleanupResources])

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
    audioSource,
    setAudioSource,
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
