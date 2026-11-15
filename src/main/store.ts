import path from 'path'
import { app } from 'electron'
import Store from 'electron-store'
import { migrateLegacyStoreFile } from './legacy-store'
import type { GlossaryEntry, Language, SourceLanguage } from '../engines/types'

/** Persisted session state for crash recovery (#54) */
export interface ActiveSession {
  config: Record<string, unknown>
  startedAt: number
}

export interface AccessibilitySettings {
  highContrast: boolean
  dyslexiaFont: boolean
  reducedMotion: boolean
  letterSpacing: number
  wordSpacing: number
}

export interface SubtitleSettings {
  fontSize: number
  sourceTextColor: string
  translatedTextColor: string
  backgroundOpacity: number
  position: 'top' | 'bottom'
  accessibility: AccessibilitySettings
}

export interface SessionLog {
  startedAt: number
  endedAt: number
  engineMode: string
  durationMs: number
  errorCount: number
}

/** A user correction of a mistranslation, stored as glossary + audit trail */
export interface CorrectionEntry {
  /** Original source text that was translated */
  sourceText: string
  /** The incorrect translation produced by the engine */
  originalTranslation: string
  /** The corrected translation provided by the user */
  correctedTranslation: string
  /** Unix timestamp in ms when the correction was made */
  timestamp: number
}

export interface AppSettings {
  translationEngine: string
  selectedMicrophone: string
  sttEngine: string
  selectedDisplay: number
  /**
   * Opt-in: write plaintext transcripts (source + translation) to userData/logs.
   * Off by default because meeting content may be confidential.
   */
  saveTranscripts: boolean
  /** Opt-in: persist the running session config so a crash can be offered for recovery (#54). */
  sessionRecoveryEnabled: boolean
  activeSession: ActiveSession | null
  subtitleSettings: SubtitleSettings
  sessionLogs: SessionLog[]
  /** Enable KV cache quantization (Q8_0) for TranslateGemma to reduce VRAM usage ~50% */
  slmKvCacheQuant: boolean
  /** TranslateGemma model size: 4B (lighter) or 12B (higher quality) */
  slmModelSize: '4b' | '12b'
  /** User-defined glossary for fixed translation of specific terms */
  glossaryTerms: GlossaryEntry[]
  /** Organization-wide glossary imported from JSON/CSV (#517) */
  orgGlossaryTerms: GlossaryEntry[]
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
  /** Enable DeepFilterNet3 noise suppression for cleaner STT input (#313) */
  noiseSuppressionEnabled: boolean
  /** Streaming chunk interval in ms (default 1000, range 500-3000) */
  streamingIntervalMs: number
  /** Show confidence-based styling on subtitle text (opacity/italic for low-confidence) */
  showConfidenceIndicator: boolean
  /** Audio source: microphone only, system audio (loopback), or both mixed */
  audioSource: 'microphone' | 'system' | 'both'
  /** Whether the user has completed the Quick Start onboarding (#510) */
  hasCompletedSetup: boolean
  /** Enable draft STT (Moonshine Tiny JA) for fast interim results (#536) */
  draftSttEnabled: boolean
  /** Enable speaker diarization via FluidAudio for multi-speaker identification (#549) */
  speakerDiarizationEnabled: boolean
  /** History of user corrections for mistranslations (#590) */
  correctionHistory: CorrectionEntry[]
  /** Whether this is a fresh install (never completed first pipeline start) (#575) */
  isFirstRun: boolean
  /** Background model download status for onboarding (#575) */
  onboardingModelStatus: 'idle' | 'downloading' | 'completed' | 'failed'
  /** Download progress percentage (0-100) for onboarding model (#575) */
  onboardingDownloadProgress: number
  /** Preferred local translation engine to switch to after download (#575) */
  preferredLocalEngine: string
  /** Current model quality tier in use: 1=basic (fast-start), 2=full-quality (#694) */
  activeModelTier: 1 | 2 | null
}

// electron-store's default file is <userData>/config.json. The legacy encrypted file must be
// rewritten before the Store opens it, otherwise the plain-JSON parse fails and conf resets it.
try {
  migrateLegacyStoreFile(path.join(app.getPath('userData'), 'config.json'))
} catch (err) {
  console.warn('[store] legacy settings migration failed:', (err as Error).message)
}

export const store = new Store<AppSettings>({
  defaults: {
    hasCompletedSetup: false,
    translationEngine: 'auto',
    sttEngine: 'mlx-whisper',
    selectedMicrophone: '',
    selectedDisplay: 0,
    saveTranscripts: false,
    sessionRecoveryEnabled: false,
    activeSession: null,
    subtitleSettings: {
      fontSize: 30,
      sourceTextColor: '#f0f0f0',
      translatedTextColor: '#93c5fd',
      backgroundOpacity: 78,
      position: 'bottom',
      accessibility: {
        highContrast: false,
        dyslexiaFont: false,
        reducedMotion: false,
        letterSpacing: 0,
        wordSpacing: 0
      }
    },
    sessionLogs: [],
    slmKvCacheQuant: true,
    slmModelSize: '4b',
    glossaryTerms: [],
    orgGlossaryTerms: [],
    slmSpeculativeDecoding: false,
    simulMtEnabled: false,
    simulMtWaitK: 3,
    whisperVariant: 'kotoba-v2.0',
    moonshineVariant: 'base',
    sherpaOnnxModel: 'whisper-base',
    sourceLanguage: 'auto',
    targetLanguage: 'en',
    noiseSuppressionEnabled: false,
    streamingIntervalMs: 800,
    showConfidenceIndicator: true,
    audioSource: 'microphone',
    draftSttEnabled: false,
    speakerDiarizationEnabled: false,
    correctionHistory: [],
    isFirstRun: true,
    onboardingModelStatus: 'idle',
    onboardingDownloadProgress: 0,
    preferredLocalEngine: 'offline-hymt15',
    activeModelTier: null
  }
})
