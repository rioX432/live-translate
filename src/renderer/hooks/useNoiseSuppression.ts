import { useCallback, useRef, useState } from 'react'
import { DeepFilterNet3Core } from 'deepfilternet3-noise-filter'

/**
 * DeepFilterNet3 noise suppression hook.
 *
 * Wraps a raw MediaStream through a DeepFilterNet3 AudioWorklet processor
 * that runs at 48 kHz.  The returned `processStream` inserts the worklet
 * between the mic source and the VAD consumer so that STT only sees
 * cleaned audio.
 *
 * Design decisions:
 *  - 48 kHz AudioContext required by DeepFilterNet3 WASM; VAD resamples
 *    internally to 16 kHz so this is transparent to downstream consumers.
 *  - Assets (WASM + model) are loaded from the default CDN on first init.
 *  - Suppression level defaults to 60 (0–100 scale).
 */

/** Default suppression level (0–100). 60 provides good balance of noise removal vs. speech distortion. */
const DEFAULT_SUPPRESSION_LEVEL = 60

export interface UseNoiseSuppressionReturn {
  /** Whether noise suppression is enabled */
  enabled: boolean
  /** Toggle noise suppression on/off */
  setEnabled: (enabled: boolean) => void
  /** Current suppression level (0–100) */
  suppressionLevel: number
  /** Update suppression level */
  setSuppressionLevel: (level: number) => void
  /** Whether the processor is initialized and ready */
  isReady: boolean
  /**
   * Process a raw MediaStream through DeepFilterNet3.
   * Returns a new MediaStream with noise-suppressed audio.
   * If suppression is disabled, returns the original stream unchanged.
   */
  processStream: (stream: MediaStream) => Promise<MediaStream>
  /** Release all resources */
  destroy: () => Promise<void>
}

export function useNoiseSuppression(): UseNoiseSuppressionReturn {
  const [enabled, setEnabled] = useState(false)
  const [suppressionLevel, setSuppressionLevel] = useState(DEFAULT_SUPPRESSION_LEVEL)
  const [isReady, setIsReady] = useState(false)

  const coreRef = useRef<DeepFilterNet3Core | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const destNodeRef = useRef<MediaStreamAudioDestinationNode | null>(null)

  const destroy = useCallback(async () => {
    try {
      workletNodeRef.current?.disconnect()
    } catch { /* ignore */ }
    try {
      sourceNodeRef.current?.disconnect()
    } catch { /* ignore */ }

    if (coreRef.current) {
      try { coreRef.current.destroy() } catch { /* ignore */ }
      coreRef.current = null
    }

    if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
      try { await audioCtxRef.current.close() } catch { /* ignore */ }
    }

    audioCtxRef.current = null
    workletNodeRef.current = null
    sourceNodeRef.current = null
    destNodeRef.current = null
    setIsReady(false)
  }, [])

  const processStream = useCallback(async (stream: MediaStream): Promise<MediaStream> => {
    if (!enabled) return stream

    // Tear down previous graph if any
    await destroy()

    try {
      // DeepFilterNet3 requires 48 kHz
      const audioTrack = stream.getAudioTracks()[0]
      const trackSettings = audioTrack.getSettings()
      const sampleRate = trackSettings.sampleRate || 48000

      const ctx = new AudioContext({ sampleRate })
      audioCtxRef.current = ctx

      const core = new DeepFilterNet3Core({
        sampleRate: ctx.sampleRate,
        noiseReductionLevel: suppressionLevel
      })
      await core.initialize()
      coreRef.current = core

      const node = await core.createAudioWorkletNode(ctx)
      workletNodeRef.current = node

      const source = ctx.createMediaStreamSource(stream)
      sourceNodeRef.current = source

      const dest = ctx.createMediaStreamDestination()
      destNodeRef.current = dest

      source.connect(node).connect(dest)

      core.setSuppressionLevel(suppressionLevel)
      core.setNoiseSuppressionEnabled(true)

      setIsReady(true)
      console.log('[noise-suppression] DeepFilterNet3 initialized at', ctx.sampleRate, 'Hz')

      return dest.stream
    } catch (err) {
      console.error('[noise-suppression] Failed to initialize DeepFilterNet3:', err)
      // Fallback: return original stream so capture still works
      await destroy()
      return stream
    }
  }, [enabled, suppressionLevel, destroy])

  // Update suppression level on the live processor
  const updateSuppressionLevel = useCallback((level: number) => {
    const clamped = Math.max(0, Math.min(100, level))
    setSuppressionLevel(clamped)
    if (coreRef.current) {
      coreRef.current.setSuppressionLevel(clamped)
    }
  }, [])

  // Update enabled state on the live processor
  const updateEnabled = useCallback((value: boolean) => {
    setEnabled(value)
    if (coreRef.current) {
      coreRef.current.setNoiseSuppressionEnabled(value)
    }
  }, [])

  return {
    enabled,
    setEnabled: updateEnabled,
    suppressionLevel,
    setSuppressionLevel: updateSuppressionLevel,
    isReady,
    processStream,
    destroy
  }
}
