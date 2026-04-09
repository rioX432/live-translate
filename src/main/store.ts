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
  /** WebSocket port for Chrome extension audio server (default 9876) */
  wsAudioPort: number
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
  /** Enable text-to-speech for translated output (#508) */
  ttsEnabled: boolean
  /** TTS voice ID (e.g. 'af_heart', 'jf_alpha') */
  ttsVoice: string
  /** TTS output device ID (empty = default output) */
  ttsOutputDevice: string
  /** TTS playback volume (0.0-1.0) */
  ttsVolume: number
  /** Enable virtual mic output for meeting translation sharing (#515) */
  virtualMicEnabled: boolean
  /** PortAudio device ID for virtual mic output (#515) */
  virtualMicDeviceId: number
  /** Enable draft STT (Moonshine Tiny JA) for fast interim results (#536) */
  draftSttEnabled: boolean
  /** Opt-in anonymous telemetry consent (#519) */
  telemetryConsent: boolean
  /** Whether the telemetry consent dialog has been shown */
  telemetryConsentShown: boolean
  /** Enable speaker diarization via FluidAudio for multi-speaker identification (#549) */
  speakerDiarizationEnabled: boolean
  /** Enable adaptive quality routing between fast and quality translation engines (#547) */
  adaptiveRoutingEnabled: boolean
  /** Adaptive routing: token count below this → fast engine only (default 10) */
  adaptiveRoutingShortThreshold: number
  /** Adaptive routing: token count above this → quality engine (default 50) */
  adaptiveRoutingLongThreshold: number
  /** Adaptive routing: quality engine ID (default 'hunyuan-mt') */
  adaptiveRoutingQualityEngine: string
  /** History of user corrections for mistranslations (#590) */
  correctionHistory: CorrectionEntry[]
}

export const store = new Store<AppSettings>({
  encryptionKey: 'live-translate-v1',
  defaults: {
    hasCompletedSetup: false,
    translationEngine: 'offline-hymt15',
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
    wsAudioPort: DEFAULT_WS_PORT,
    noiseSuppressionEnabled: false,
    streamingIntervalMs: 1000,
    showConfidenceIndicator: true,
    audioSource: 'microphone',
    ttsEnabled: false,
    ttsVoice: 'af_heart',
    ttsOutputDevice: '',
    ttsVolume: 0.8,
    virtualMicEnabled: false,
    virtualMicDeviceId: -1,
    draftSttEnabled: false,
    telemetryConsent: false,
    telemetryConsentShown: false,
    speakerDiarizationEnabled: false,
    adaptiveRoutingEnabled: false,
    adaptiveRoutingShortThreshold: 10,
    adaptiveRoutingLongThreshold: 50,
    adaptiveRoutingQualityEngine: 'hunyuan-mt',
    correctionHistory: []
  }
})
