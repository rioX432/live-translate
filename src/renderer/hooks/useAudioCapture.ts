import { useCallback, useEffect, useRef, useState } from 'react'
import { MicVAD } from '@ricky0123/vad-web'
import { SpeechSegmenter, createSegmentIdFactory, type SegmentAudio } from '../audio/speech-segmenter'

export type { SegmentAudio }

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
  /**
   * Receive segment audio: interims re-send the whole segment so far, and each
   * segment ends with exactly one final. Returns an unsubscribe function.
   */
  onSegmentAudio: (callback: (audio: SegmentAudio) => void) => () => void
}

/** Optional noise suppression preprocessor injected from the parent component */
export interface NoiseSuppressionProcessor {
  processStream: (stream: MediaStream) => Promise<MediaStream>
  destroy: () => Promise<void>
}

const DEFAULT_STREAMING_INTERVAL_MS = 800
const SAMPLE_RATE = 16000
// Kept in sync with the MicVAD options below.
const POSITIVE_SPEECH_THRESHOLD = 0.25
/** vad-web's default preSpeechPadMs, which the VAD's own segments also include */
const PRE_ROLL_SECONDS = 0.8
/** Long monologues are split so one STT call never covers more than this. */
const MAX_SEGMENT_SECONDS = 12
const SPLIT_SEARCH_SECONDS = 3
const MIN_INTERIM_SECONDS = 0.5

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
  const segmentCallbackRef = useRef<((audio: SegmentAudio) => void) | null>(null)

  // #501: Track loopback and mixer resources for cleanup
  const loopbackStreamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)

  const segmenterRef = useRef<SpeechSegmenter | null>(null)
  if (!segmenterRef.current) {
    segmenterRef.current = new SpeechSegmenter({
      sampleRate: SAMPLE_RATE,
      preRollSamples: Math.round(PRE_ROLL_SECONDS * SAMPLE_RATE),
      maxSegmentSamples: MAX_SEGMENT_SECONDS * SAMPLE_RATE,
      splitSearchSamples: SPLIT_SEARCH_SECONDS * SAMPLE_RATE,
      minInterimSamples: MIN_INTERIM_SECONDS * SAMPLE_RATE,
      newId: createSegmentIdFactory()
    })
  }
  const streamingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const emit = useCallback((audio: SegmentAudio | null) => {
    if (audio) segmentCallbackRef.current?.(audio)
  }, [])

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

  const startStreamingTimer = useCallback(() => {
    if (streamingTimerRef.current) return
    streamingTimerRef.current = setInterval(() => {
      emit(segmenterRef.current!.interim())
    }, effectiveInterval)
  }, [emit, effectiveInterval])

  const stopStreamingTimer = useCallback(() => {
    if (streamingTimerRef.current) {
      clearInterval(streamingTimerRef.current)
      streamingTimerRef.current = null
    }
  }, [])

  // Consolidated cleanup for loopback stream, AudioContext, and segment state
  const cleanupResources = useCallback(() => {
    if (loopbackStreamRef.current) {
      loopbackStreamRef.current.getTracks().forEach((t) => t.stop())
      loopbackStreamRef.current = null
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch((err) => console.warn('[audio-capture] AudioContext close error:', err))
      audioContextRef.current = null
    }
    segmenterRef.current?.reset()
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
        positiveSpeechThreshold: POSITIVE_SPEECH_THRESHOLD,
        negativeSpeechThreshold: 0.1,
        redemptionMs: 800,
        minSpeechMs: 250,
        // AudioWorklet runs audio processing off the main thread (replaces deprecated ScriptProcessor)
        processorType: 'AudioWorklet',
        // Serve ONNX model and WASM from public/vad/ (dev) or vad-asset:// protocol (packaged).
        // Dynamic import() cannot read from asar, so packaged app uses a custom protocol
        // that serves from app.asar.unpacked.
        baseAssetPath: window.location.protocol === 'file:' ? 'vad-asset://host/' : '/vad/',
        onnxWASMBasePath: window.location.protocol === 'file:' ? 'vad-asset://host/' : '/vad/',
        onFrameProcessed: (probs, frame) => {
          // Volume meter (RMS) from each frame
          let sum = 0
          for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i]
          const rms = Math.sqrt(sum / frame.length)
          setVolume(Math.min(1, rms * 5))
          emit(segmenterRef.current!.frame(frame, probs.isSpeech >= POSITIVE_SPEECH_THRESHOLD, Date.now()))
        },
        onSpeechStart: () => segmenterRef.current!.speechStart(),
        onSpeechRealStart: () => segmenterRef.current!.speechRealStart(),
        onSpeechEnd: () => emit(segmenterRef.current!.speechEnd()),
        onVADMisfire: () => emit(segmenterRef.current!.misfire())
      })

      vadRef.current = vad
      vad.start()
      startStreamingTimer()
      setIsCapturing(true)
      console.log('[audio-capture] VAD started')
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
  }, [selectedDevice, audioSource, isCapturing, startStreamingTimer, stopStreamingTimer, getLoopbackStream, mixStreams, cleanupResources, emit])

  const stop = useCallback(() => {
    stopStreamingTimer()
    // Close the utterance in progress so its interim subtitle gets a final.
    emit(segmenterRef.current!.flush())
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
  }, [stopStreamingTimer, noiseSuppression, cleanupResources, emit])

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

  const onSegmentAudio = useCallback((callback: (audio: SegmentAudio) => void) => {
    segmentCallbackRef.current = callback
    return () => { segmentCallbackRef.current = null }
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
    onSegmentAudio
  }
}
