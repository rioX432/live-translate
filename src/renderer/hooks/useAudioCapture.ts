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
  start: () => Promise<void>
  stop: () => void
  /** Callback for VAD-detected complete speech segments (legacy mode) */
  onAudioChunk: (callback: (chunk: Float32Array) => void) => void
  /** Callback for periodic rolling buffer during speech (streaming mode) */
  onStreamingChunk: (callback: (buffer: Float32Array) => void) => void
  /** Callback when speech segment ends (streaming mode finalization) */
  onSpeechSegmentEnd: (callback: (finalBuffer: Float32Array) => void) => void
}

const STREAMING_INTERVAL_MS = 2000
const SAMPLE_RATE = 16000

export function useAudioCapture(): UseAudioCaptureReturn {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string>('')
  const [isCapturing, setIsCapturing] = useState(false)
  const [volume, setVolume] = useState(0)
  const [permissionError, setPermissionError] = useState<string | null>(null) // #48

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
        if (audioInputs.length > 0 && !selectedDevice) {
          setSelectedDevice(audioInputs[0].deviceId)
        }
      } catch (err) {
        console.error('Failed to enumerate audio devices:', err)
        // #48: surface permission errors to UI
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('Permission') || message.includes('NotAllowedError')) {
          setPermissionError('Microphone access denied. Please grant permission in System Preferences.')
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
    return buffer
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
    }, STREAMING_INTERVAL_MS)
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
        return navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            channelCount: 1,
            sampleRate: { ideal: 16000 },
            echoCancellation: true,
            noiseSuppression: true
          }
        })
      },
      // Override with more sensitive thresholds for real-time translation
      positiveSpeechThreshold: 0.3,
      negativeSpeechThreshold: 0.15,
      redemptionMs: 1400,
      minSpeechMs: 400,
      // ScriptProcessor for Electron compatibility
      processorType: 'ScriptProcessor',
      // Serve ONNX model and WASM from public/vad/
      baseAssetPath: '/vad/',
      onnxWASMBasePath: '/vad/',
      onFrameProcessed: (_probs, frame) => {
        // Volume meter (RMS) from each frame
        let sum = 0
        for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
        const rms = Math.sqrt(sum / frame.length)
        setVolume(Math.min(1, rms * 5))

        // #53: accumulate frames in circular buffer during speech
        if (isSpeakingRef.current) {
          const maxFrames = Math.floor((30 * SAMPLE_RATE) / frame.length)
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
    isSpeakingRef.current = false
    rollingBufferRef.current = []
    rollingBufferIndexRef.current = 0
    rollingBufferFullRef.current = false
    setIsCapturing(false)
    setVolume(0)
    console.log('[audio-capture] VAD stopped')
  }, [stopStreamingTimer])

  const onAudioChunk = useCallback((callback: (chunk: Float32Array) => void) => {
    chunkCallbackRef.current = callback
  }, [])

  const onStreamingChunk = useCallback((callback: (buffer: Float32Array) => void) => {
    streamingCallbackRef.current = callback
  }, [])

  const onSpeechSegmentEnd = useCallback((callback: (finalBuffer: Float32Array) => void) => {
    speechEndCallbackRef.current = callback
  }, [])

  return {
    devices,
    selectedDevice,
    setSelectedDevice,
    isCapturing,
    volume,
    permissionError,
    start,
    stop,
    onAudioChunk,
    onStreamingChunk,
    onSpeechSegmentEnd
  }
}
