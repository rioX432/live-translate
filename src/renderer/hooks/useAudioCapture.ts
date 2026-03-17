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
  start: () => Promise<void>
  stop: () => void
  onAudioChunk: (callback: (chunk: Float32Array) => void) => void
}

export function useAudioCapture(): UseAudioCaptureReturn {
  const [devices, setDevices] = useState<AudioDevice[]>([])
  const [selectedDevice, setSelectedDevice] = useState<string>('')
  const [isCapturing, setIsCapturing] = useState(false)
  const [volume, setVolume] = useState(0)

  const vadRef = useRef<MicVAD | null>(null)
  const chunkCallbackRef = useRef<((chunk: Float32Array) => void) | null>(null)

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
      }
    }
    enumerate()
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
            echoCancellation: true,
            noiseSuppression: true
          }
        })
      },
      // Use verified defaults (positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35 are too aggressive)
      // Library defaults: positiveSpeechThreshold=0.5, negativeSpeechThreshold=0.35
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
      },
      onSpeechEnd: (audio: Float32Array) => {
        // audio is 16kHz Float32Array from VAD
        console.log(`[audio-capture] VAD speech segment: ${audio.length} samples (${(audio.length / 16000).toFixed(1)}s)`)
        chunkCallbackRef.current?.(audio)
      },
      onSpeechStart: () => {
        console.log('[audio-capture] VAD speech start')
      },
      onVADMisfire: () => {
        console.log('[audio-capture] VAD misfire (speech too short)')
      }
    })

    vadRef.current = vad
    vad.start()
    setIsCapturing(true)
    console.log('[audio-capture] VAD started')
  }, [selectedDevice, isCapturing])

  const stop = useCallback(() => {
    if (vadRef.current) {
      vadRef.current.destroy()
      vadRef.current = null
    }
    setIsCapturing(false)
    setVolume(0)
    console.log('[audio-capture] VAD stopped')
  }, [])

  const onAudioChunk = useCallback((callback: (chunk: Float32Array) => void) => {
    chunkCallbackRef.current = callback
  }, [])

  return {
    devices,
    selectedDevice,
    setSelectedDevice,
    isCapturing,
    volume,
    start,
    stop,
    onAudioChunk
  }
}
