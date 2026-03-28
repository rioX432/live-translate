/** Supported language codes (ISO 639-1) */
export type Language = 'ja' | 'en' | 'zh' | 'ko' | 'fr' | 'de' | 'es' | 'pt' | 'ru' | 'it' | 'nl' | 'pl' | 'ar' | 'th' | 'vi' | 'id'

/** Source language setting: specific language or auto-detect */
export type SourceLanguage = 'auto' | Language

/** Human-readable language labels */
export const LANGUAGE_LABELS: Record<Language, string> = {
  ja: 'Japanese',
  en: 'English',
  zh: 'Chinese',
  ko: 'Korean',
  fr: 'French',
  de: 'German',
  es: 'Spanish',
  pt: 'Portuguese',
  ru: 'Russian',
  it: 'Italian',
  nl: 'Dutch',
  pl: 'Polish',
  ar: 'Arabic',
  th: 'Thai',
  vi: 'Vietnamese',
  id: 'Indonesian'
}

/** All supported language codes */
export const ALL_LANGUAGES: Language[] = Object.keys(LANGUAGE_LABELS) as Language[]

/** STT engine result */
export interface STTResult {
  /** Recognized text */
  text: string
  /** Detected language of the audio */
  language: Language
  /** Whether this is a final (committed) result or an interim (tentative) result */
  isFinal: boolean
  /** Unix timestamp in ms */
  timestamp: number
  /** Speaker identifier (if diarization is enabled) */
  speakerId?: string
  /** STT confidence score (0.0–1.0). Used by GER to decide if correction is needed. */
  confidence?: number
}

/** Translation pipeline result */
export interface TranslationResult {
  /** Original recognized text */
  sourceText: string
  /** Translated text */
  translatedText: string
  /** Source language */
  sourceLanguage: Language
  /** Target language */
  targetLanguage: Language
  /** Unix timestamp in ms */
  timestamp: number
  /** Whether this is an interim (unconfirmed) result from streaming mode */
  isInterim?: boolean
  /** Speaker identifier (if diarization is enabled) */
  speakerId?: string
  /** Translation stage: 'draft' (OPUS-MT), 'refined' (LLM), or 'ger-corrected' (GER post-correction) */
  translationStage?: 'draft' | 'refined' | 'ger-corrected'
}

/**
 * Speech-to-Text engine interface.
 * Implementations: WhisperLocalEngine
 */
export interface STTEngine {
  readonly id: string
  readonly name: string
  readonly isOffline: boolean

  /** Load model and prepare for inference */
  initialize(): Promise<void>

  /**
   * Process an audio chunk and return recognized text.
   * Returns null if no speech detected in the chunk.
   */
  processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null>

  /** Release resources */
  dispose(): Promise<void>
}

/**
 * Text-to-text translation engine interface.
 * Implementations: GoogleTranslator
 */
export interface TranslatorEngine {
  readonly id: string
  readonly name: string
  readonly isOffline: boolean

  /** Initialize (e.g. validate API key) */
  initialize(): Promise<void>

  /** Translate text from one language to another */
  translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string>

  /**
   * Incremental translation for SimulMT (Wait-k policy).
   * Translates partial source text while maintaining consistency with previous output.
   * The returned translation must extend (not replace) previousOutput.
   * Optional — only offline LLM engines (TranslateGemma, Hunyuan-MT) support this.
   */
  translateIncremental?(
    text: string,
    previousOutput: string,
    from: Language,
    to: Language,
    context?: TranslateContext
  ): Promise<string>

  /** Release resources */
  dispose(): Promise<void>
}

/**
 * End-to-end engine that performs STT + translation in a single step.
 * Implementations: WhisperTranslateEngine
 */
export interface E2ETranslationEngine {
  readonly id: string
  readonly name: string
  readonly isOffline: boolean

  /** Load model and prepare for inference */
  initialize(): Promise<void>

  /**
   * Process audio and directly produce a translation result.
   * Returns null if no speech detected.
   */
  processAudio(audioChunk: Float32Array, sampleRate: number): Promise<TranslationResult | null>

  /** Release resources */
  dispose(): Promise<void>
}

/** A glossary entry mapping a source term to its fixed translation */
export interface GlossaryEntry {
  source: string
  target: string
}

/** Context passed to translators that support context-aware translation */
export interface TranslateContext {
  /** Previous confirmed translation segments for coherence */
  previousSegments: Array<{ source: string; translated: string; speakerId?: string }>
  /** Glossary terms that must use fixed translations */
  glossary?: GlossaryEntry[]
  /** Current speaker identifier for style adaptation */
  speakerId?: string
}

/** Pipeline mode */
export type PipelineMode = 'cascade' | 'e2e'

/** Engine configuration for the pipeline */
export interface EngineConfig {
  /** cascade: STT + Translator separately. e2e: single engine does both */
  mode: PipelineMode
  /** STT engine ID (cascade mode only) */
  sttEngineId?: string
  /** Translator engine ID (cascade mode only) */
  translatorEngineId?: string
  /** E2E engine ID (e2e mode only) */
  e2eEngineId?: string
}

/** Engine registry entry */
export interface EngineInfo {
  id: string
  name: string
  type: 'stt' | 'translator' | 'e2e'
  isOffline: boolean
  description: string
}
