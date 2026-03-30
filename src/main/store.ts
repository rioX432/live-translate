import Store from 'electron-store'
import type { GlossaryEntry, Language, SourceLanguage } from '../engines/types'
import { DEFAULT_WS_PORT } from './constants'

export interface QuotaRecord {
  monthKey: string
  charCount: number
}

/** Persisted session state for crash recovery (#54) */
export interface ActiveSession {
  config: Record<string, unknown>
  startedAt: number
}

export interface SubtitleSettings {
  fontSize: number
  sourceTextColor: string
  translatedTextColor: string
  backgroundOpacity: number
  position: 'top' | 'bottom'
}

export interface SessionLog {
  startedAt: number
  endedAt: number
  engineMode: string
  durationMs: number
  errorCount: number
}

export interface AppSettings {
  translationEngine: string
  googleApiKey: string
  microsoftApiKey: string
  microsoftRegion: string
  deeplApiKey: string
  geminiApiKey: string
  selectedMicrophone: string
  sttEngine: string
  selectedDisplay: number
  quotaTracking: Record<string, QuotaRecord>
  activeSession: ActiveSession | null
  subtitleSettings: SubtitleSettings
  sessionLogs: SessionLog[]
  /** Enable KV cache quantization (Q8_0) for TranslateGemma to reduce VRAM usage ~50% */
  slmKvCacheQuant: boolean
  /** TranslateGemma model size: 4B (lighter) or 12B (higher quality) */
  slmModelSize: '4b' | '12b'
  /** User-defined glossary for fixed translation of specific terms */
  glossaryTerms: GlossaryEntry[]
  /** Enable speculative decoding: 4B draft model + 12B verifier for 2-3x throughput */
  slmSpeculativeDecoding: boolean
  /** Enable simultaneous translation (SimulMT) with Wait-k policy for lower latency */
  simulMtEnabled: boolean
  /** Wait-k value: start translating after k confirmed words (default 3) */
  simulMtWaitK: number
  /** Whisper model variant for local STT: kotoba-v2.0 (Japanese-optimized) or large-v3-turbo (multilingual) */
  whisperVariant: string
  /** Moonshine model variant for local STT: tiny (fastest) or base (recommended) */
  moonshineVariant: string
  /** Sherpa-ONNX model key: whisper-tiny, whisper-base, sensevoice-small, paraformer-zh */
  sherpaOnnxModel: string
  /** Source language: 'auto' for auto-detection or a specific language code */
  sourceLanguage: SourceLanguage
  /** Target language for translation output */
  targetLanguage: Language
  /** WebSocket port for Chrome extension audio server (default 9876) */
  wsAudioPort: number
  /** Enable DeepFilterNet3 noise suppression for cleaner STT input (#313) */
  noiseSuppressionEnabled: boolean
  /** Streaming chunk interval in ms (default 1000, range 500-3000) */
  streamingIntervalMs: number
}

export const store = new Store<AppSettings>({
  encryptionKey: 'live-translate-v1',
  defaults: {
    translationEngine: 'offline-opus',
    googleApiKey: '',
    microsoftApiKey: '',
    microsoftRegion: '',
    deeplApiKey: '',
    geminiApiKey: '',
    sttEngine: 'mlx-whisper',
    selectedMicrophone: '',
    selectedDisplay: 0,
    quotaTracking: {},
    activeSession: null,
    subtitleSettings: {
      fontSize: 30,
      sourceTextColor: '#f0f0f0',
      translatedTextColor: '#93c5fd',
      backgroundOpacity: 78,
      position: 'bottom'
    },
    sessionLogs: [],
    slmKvCacheQuant: true,
    slmModelSize: '4b',
    glossaryTerms: [],
    slmSpeculativeDecoding: false,
    simulMtEnabled: false,
    simulMtWaitK: 3,
    whisperVariant: 'kotoba-v2.0',
    moonshineVariant: 'base',
    sherpaOnnxModel: 'whisper-base',
    sourceLanguage: 'auto',
    targetLanguage: 'en',
    wsAudioPort: DEFAULT_WS_PORT,
    noiseSuppressionEnabled: false,
    streamingIntervalMs: 1000
  }
})
