import Store from 'electron-store'
import type { GlossaryEntry } from '../engines/types'

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
}

export const store = new Store<AppSettings>({
  encryptionKey: 'live-translate-v1',
  defaults: {
    translationEngine: 'auto',
    googleApiKey: '',
    microsoftApiKey: '',
    microsoftRegion: '',
    deeplApiKey: '',
    geminiApiKey: '',
    sttEngine: 'whisper-local',
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
    simulMtWaitK: 3
  }
})
