import type { TTSEngine, TTSResult, Language } from '../types'
import { createLogger } from '../../main/logger'

const log = createLogger('kokoro-tts')

const MODEL_ID = 'onnx-community/Kokoro-82M-v1.0-ONNX'

/** Default voice for each supported language */
const DEFAULT_VOICES: Partial<Record<Language, string>> = {
  en: 'af_heart',
  ja: 'jf_alpha',
  zh: 'zf_xiaobei',
  fr: 'ff_siwis',
  es: 'ef_dora',
  it: 'if_sara',
  pt: 'pf_dora',
  de: 'af_heart', // No German voice — fallback to English
  ko: 'af_heart', // No Korean voice — fallback to English
  ru: 'af_heart',
  nl: 'af_heart',
  pl: 'af_heart',
  ar: 'af_heart',
  th: 'af_heart',
  vi: 'af_heart',
  id: 'af_heart'
}

/** All available voice options grouped by language */
export const TTS_VOICES: Record<string, Array<{ id: string; label: string }>> = {
  en: [
    { id: 'af_heart', label: 'Heart (F)' },
    { id: 'af_bella', label: 'Bella (F)' },
    { id: 'af_nova', label: 'Nova (F)' },
    { id: 'af_sarah', label: 'Sarah (F)' },
    { id: 'af_sky', label: 'Sky (F)' },
    { id: 'am_adam', label: 'Adam (M)' },
    { id: 'am_echo', label: 'Echo (M)' },
    { id: 'am_michael', label: 'Michael (M)' },
    { id: 'bf_alice', label: 'Alice (F, British)' },
    { id: 'bf_emma', label: 'Emma (F, British)' },
    { id: 'bm_daniel', label: 'Daniel (M, British)' },
    { id: 'bm_george', label: 'George (M, British)' }
  ],
  ja: [
    { id: 'jf_alpha', label: 'Alpha (F)' },
    { id: 'jf_gongitsune', label: 'Gongitsune (F)' },
    { id: 'jf_nezumi', label: 'Nezumi (F)' },
    { id: 'jf_tebukuro', label: 'Tebukuro (F)' },
    { id: 'jm_kumo', label: 'Kumo (M)' }
  ],
  zh: [
    { id: 'zf_xiaobei', label: 'Xiaobei (F)' },
    { id: 'zf_xiaoni', label: 'Xiaoni (F)' },
    { id: 'zm_yunjian', label: 'Yunjian (M)' },
    { id: 'zm_yunxi', label: 'Yunxi (M)' }
  ]
}

interface KokoroTTSOptions {
  onProgress?: (message: string) => void
  /** Override voice ID (must be a valid Kokoro voice) */
  voice?: string
}

/**
 * Kokoro-82M TTS engine using kokoro-js (ONNX Runtime).
 * Runs on CPU in the main process — 82M params, lightweight.
 */
export class KokoroTTSEngine implements TTSEngine {
  readonly id = 'kokoro-tts'
  readonly name = 'Kokoro-82M TTS'

  private tts: KokoroTTSInstance | null = null
  private initialized = false
  private onProgress?: (message: string) => void
  private voiceOverride?: string

  constructor(options?: KokoroTTSOptions) {
    this.onProgress = options?.onProgress
    this.voiceOverride = options?.voice
  }

  async initialize(): Promise<void> {
    if (this.initialized && this.tts) return

    this.onProgress?.('Loading Kokoro-82M TTS model...')
    log.info('Initializing Kokoro-82M TTS engine')

    try {
      // Dynamic import to avoid loading ONNX at startup
      const { KokoroTTS } = await import('kokoro-js')
      this.tts = await KokoroTTS.from_pretrained(MODEL_ID, {
        dtype: 'q8',
        device: 'cpu'
      }) as KokoroTTSInstance

      this.initialized = true
      this.onProgress?.('Kokoro-82M TTS ready')
      log.info('Kokoro-82M TTS engine initialized')
    } catch (err) {
      log.error('Failed to initialize Kokoro-82M TTS:', err)
      this.tts = null
      this.initialized = false
      throw err
    }
  }

  async synthesize(text: string, language: Language): Promise<TTSResult> {
    if (!this.tts) {
      throw new Error('Kokoro TTS not initialized')
    }

    if (!text.trim()) {
      // Return silent audio for empty input
      return { audio: new Float32Array(0), sampleRate: 24000 }
    }

    const voice = this.voiceOverride || DEFAULT_VOICES[language] || 'af_heart'
    const t0 = performance.now()

    try {
      const rawAudio = await this.tts.generate(text, { voice })
      const elapsed = (performance.now() - t0).toFixed(0)
      log.info(`TTS: ${elapsed}ms, ${text.length} chars, voice=${voice}`)

      // RawAudio from kokoro-js has .audio (Float32Array) and .sampling_rate
      return {
        audio: rawAudio.audio as Float32Array,
        sampleRate: (rawAudio as RawAudioLike).sampling_rate ?? 24000
      }
    } catch (err) {
      log.error('TTS synthesis failed:', err)
      throw err
    }
  }

  /** Update the voice to use for synthesis */
  setVoice(voiceId: string): void {
    this.voiceOverride = voiceId
    log.info(`TTS voice changed to: ${voiceId}`)
  }

  async dispose(): Promise<void> {
    this.tts = null
    this.initialized = false
    log.info('Kokoro-82M TTS engine disposed')
  }
}

/** Minimal type for the kokoro-js KokoroTTS instance */
interface KokoroTTSInstance {
  generate(text: string, options: { voice: string; speed?: number }): Promise<RawAudioLike>
}

/** Minimal type for the RawAudio output from kokoro-js */
interface RawAudioLike {
  audio: ArrayLike<number>
  sampling_rate?: number
  save?: (path: string) => void
}
