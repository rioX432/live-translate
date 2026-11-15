import path from 'path'
import { app } from 'electron'
import Store from 'electron-store'
import { migrateLegacyStoreFile } from './legacy-store'
import type { GlossaryEntry, Language, SourceLanguage } from '../engines/types'
import { DEFAULT_WS_PORT } from './constants'

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

export interface AppSettings {
  translationEngine: string
  selectedMicrophone: string
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
  /** TranslateGemma model size: 4B (lighter) or 12B (higher quality) */
  slmModelSize: '4b' | '12b'
  /** User-defined glossary for fixed translation of specific terms */
  glossaryTerms: GlossaryEntry[]
  /** Organization-wide glossary imported from JSON/CSV (#517) */
  orgGlossaryTerms: GlossaryEntry[]
  /** Enable simultaneous translation (SimulMT) with Wait-k policy for lower latency */
  simulMtEnabled: boolean
  /** Wait-k value: start translating after k confirmed words (default 3) */
  simulMtWaitK: number
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
  /** Opt-in anonymous telemetry consent (#519) */
  telemetryConsent: boolean
  /** Whether the telemetry consent dialog has been shown */
  telemetryConsentShown: boolean
  /** Enable speaker diarization via FluidAudio for multi-speaker identification (#549) */
  speakerDiarizationEnabled: boolean
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
    slmModelSize: '4b',
    glossaryTerms: [],
    orgGlossaryTerms: [],
    simulMtEnabled: false,
    simulMtWaitK: 3,
    sourceLanguage: 'auto',
    targetLanguage: 'en',
    wsAudioPort: DEFAULT_WS_PORT,
    noiseSuppressionEnabled: false,
    streamingIntervalMs: 800,
    showConfidenceIndicator: true,
    audioSource: 'microphone',
    ttsEnabled: false,
    ttsVoice: 'af_heart',
    ttsOutputDevice: '',
    ttsVolume: 0.8,
    virtualMicEnabled: false,
    virtualMicDeviceId: -1,
    telemetryConsent: false,
    telemetryConsentShown: false,
    speakerDiarizationEnabled: false,
    isFirstRun: true,
    onboardingModelStatus: 'idle',
    onboardingDownloadProgress: 0,
    preferredLocalEngine: 'offline-hymt15',
    activeModelTier: null
  }
})
