import { useCallback, useEffect, useRef, useState } from 'react'

const TARGET_SAMPLE_RATE = 16000
const CHUNK_DURATION_SEC = 3 // Send audio every 3 seconds

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

  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const workletRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null)
  const chunkCallbackRef = useRef<((chunk: Float32Array) => void) | null>(null)
  const bufferRef = useRef<Float32Array[]>([])
  const bufferSamplesRef = useRef(0)

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

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: selectedDevice ? { exact: selectedDevice } : undefined,
        channelCount: 1,
        sampleRate: { ideal: TARGET_SAMPLE_RATE },
        echoCancellation: true,
        noiseSuppression: true
      }
    })

    streamRef.current = stream
    const context = new AudioContext({ sampleRate: TARGET_SAMPLE_RATE })
    contextRef.current = context
    const source = context.createMediaStreamSource(stream)

    // Use ScriptProcessorNode (deprecated but widely supported)
    const bufferSize = 4096
    const processor = context.createScriptProcessor(bufferSize, 1, 1)
    workletRef.current = processor

    const samplesPerChunk = TARGET_SAMPLE_RATE * CHUNK_DURATION_SEC
    bufferRef.current = []
    bufferSamplesRef.current = 0

    console.log('[audio-capture] AudioContext sampleRate:', context.sampleRate)
    console.log('[audio-capture] Stream tracks:', stream.getAudioTracks().map(t => `${t.label} (${t.readyState})`))

    processor.onaudioprocess = (e): void => {
      const inputData = e.inputBuffer.getChannelData(0)
      const chunk = new Float32Array(inputData)

      // Volume meter (RMS)
      let sum = 0
      for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i]
      const rms = Math.sqrt(sum / chunk.length)
      setVolume(Math.min(1, rms * 5))

      // Debug: log first chunk stats
      if (bufferSamplesRef.current === 0) {
        let maxVal = 0
        for (let i = 0; i < chunk.length; i++) {
          const abs = Math.abs(chunk[i])
          if (abs > maxVal) maxVal = abs
        }
        console.log(`[audio-capture] chunk: len=${chunk.length}, rms=${rms.toFixed(6)}, max=${maxVal.toFixed(6)}`)
      }

      // Accumulate buffer
      bufferRef.current.push(chunk)
      bufferSamplesRef.current += chunk.length

      // Emit chunk when buffer is full
      if (bufferSamplesRef.current >= samplesPerChunk) {
        const totalLength = bufferRef.current.reduce((acc, b) => acc + b.length, 0)
        const merged = new Float32Array(totalLength)
        let offset = 0
        for (const buf of bufferRef.current) {
          merged.set(buf, offset)
          offset += buf.length
        }
        bufferRef.current = []
        bufferSamplesRef.current = 0

        chunkCallbackRef.current?.(merged)
      }
    }

    source.connect(processor)
    processor.connect(context.destination)
    setIsCapturing(true)
  }, [selectedDevice, isCapturing])

  const stop = useCallback(() => {
    workletRef.current?.disconnect()
    streamRef.current?.getTracks().forEach((t) => t.stop())
    contextRef.current?.close()
    workletRef.current = null
    streamRef.current = null
    contextRef.current = null
    bufferRef.current = []
    bufferSamplesRef.current = 0
    setIsCapturing(false)
    setVolume(0)
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
