import React from 'react'

/** Supported language codes — must match Language type in types.ts */
export type Language = 'ja' | 'en' | 'zh' | 'ko' | 'fr' | 'de' | 'es' | 'pt' | 'ru' | 'it' | 'nl' | 'pl' | 'ar' | 'th' | 'vi' | 'id'
export type SourceLanguage = 'auto' | Language

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

export const ALL_LANGUAGES = Object.keys(LANGUAGE_LABELS) as Language[]

export type EngineMode = 'auto' | 'rotation' | 'online' | 'online-deepl' | 'online-gemini' | 'offline-opus' | 'offline-hunyuan-mt' | 'offline-hybrid'

export type SttEngineType = 'whisper-local' | 'mlx-whisper'
export type WhisperVariantType = 'kotoba-v2.0' | 'large-v3-turbo' | 'base' | 'small'
export type SubtitlePositionType = 'top' | 'bottom'

export interface DisplayInfo {
  id: number
  label: string
}

/** Wrap a promise with a timeout to prevent UI freezes when main process hangs */
export function withIpcTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer))
}

// Shared styles used across settings sub-components
export const selectStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: '13px',
  background: '#1e293b',
  color: '#e2e8f0',
  border: '1px solid #334155',
  borderRadius: '6px'
}

export const inputStyle: React.CSSProperties = {
  ...selectStyle,
  fontFamily: 'monospace'
}

export const radioLabelStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '8px',
  fontSize: '13px',
  color: '#e2e8f0',
  cursor: 'pointer',
  padding: '6px 0'
}

export const buttonStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px',
  fontSize: '15px',
  fontWeight: 700,
  border: 'none',
  borderRadius: '8px',
  cursor: 'pointer',
  color: '#fff',
  marginTop: '8px'
}

export const sliderLabelStyle: React.CSSProperties = {
  fontSize: '12px',
  color: '#94a3b8',
  marginBottom: '4px'
}

export const colorInputStyle: React.CSSProperties = {
  width: '100%',
  height: '32px',
  padding: '2px',
  background: '#1e293b',
  border: '1px solid #334155',
  borderRadius: '6px',
  cursor: 'pointer'
}

// --- Engine mode utilities ---

/** API-based engine modes that require at least one API key */
export const API_ENGINE_MODES: EngineMode[] = ['rotation', 'online', 'online-deepl', 'online-gemini']

/** LLM-based engine modes that support KV cache / SimulMT options */
export const LLM_ENGINE_MODES: EngineMode[] = ['offline-hunyuan-mt', 'offline-hybrid']

/** Display name for each engine mode */
export function getEngineDisplayName(mode: EngineMode): string {
  switch (mode) {
    case 'offline-opus': return 'OPUS-MT'
    case 'offline-hunyuan-mt': return 'Hunyuan-MT 7B (High Quality)'
    case 'offline-hybrid': return 'Hybrid (OPUS-MT + TranslateGemma)'
    case 'rotation': return 'API Auto Rotation'
    case 'online': return 'Google Translation'
    case 'online-deepl': return 'DeepL'
    case 'online-gemini': return 'Gemini 2.5 Flash'
    case 'auto': return 'Auto'
    default: return mode
  }
}

/** Display name for STT engine + variant */
export function getSttDisplayName(sttEngine: SttEngineType, whisperVariant: WhisperVariantType): string {
  switch (sttEngine) {
    case 'mlx-whisper': return 'mlx-whisper (Apple Silicon)'
    case 'whisper-local': {
      const variantLabels: Record<string, string> = {
        'kotoba-v2.0': 'kotoba-v2.0',
        'large-v3-turbo': 'large-v3-turbo',
        'small': 'small, fast',
        'base': 'base, fastest'
      }
      return `Whisper (${variantLabels[whisperVariant] || whisperVariant})`
    }
    default: return sttEngine
  }
}

/** Resolve 'auto' engine mode to a concrete mode based on available keys and GPU */
export function resolveEngineMode(
  mode: EngineMode,
  apiKeys: { apiKey: string; deeplApiKey: string; geminiApiKey: string; microsoftApiKey: string; microsoftRegion: string },
  gpuInfo: { hasGpu: boolean } | null
): EngineMode {
  if (mode !== 'auto') return mode
  const hasKeys = !!(apiKeys.apiKey || apiKeys.deeplApiKey || apiKeys.geminiApiKey || (apiKeys.microsoftApiKey && apiKeys.microsoftRegion))
  if (hasKeys) return 'rotation'
  if (gpuInfo?.hasGpu) return 'offline-hunyuan-mt'
  return 'offline-opus'
}

/** Build pipeline config from resolved engine mode and settings */
export function buildEngineConfig(
  resolvedMode: EngineMode,
  sttEngine: SttEngineType,
  apiKeys: { apiKey: string; deeplApiKey: string; geminiApiKey: string; microsoftApiKey: string; microsoftRegion: string }
): Record<string, unknown> {
  const base = { mode: 'cascade' as const, sttEngineId: sttEngine }

  switch (resolvedMode) {
    case 'rotation':
      return {
        ...base,
        translatorEngineId: 'rotation-controller',
        ...(apiKeys.apiKey && { apiKey: apiKeys.apiKey }),
        ...(apiKeys.deeplApiKey && { deeplApiKey: apiKeys.deeplApiKey }),
        ...(apiKeys.geminiApiKey && { geminiApiKey: apiKeys.geminiApiKey }),
        ...(apiKeys.microsoftApiKey && apiKeys.microsoftRegion && { microsoftApiKey: apiKeys.microsoftApiKey, microsoftRegion: apiKeys.microsoftRegion })
      }
    case 'online':
      return { ...base, translatorEngineId: 'google-translate', apiKey: apiKeys.apiKey }
    case 'online-deepl':
      return { ...base, translatorEngineId: 'deepl-translate', deeplApiKey: apiKeys.deeplApiKey }
    case 'online-gemini':
      return { ...base, translatorEngineId: 'gemini-translate', geminiApiKey: apiKeys.geminiApiKey }
    case 'offline-hunyuan-mt':
      return { ...base, translatorEngineId: 'hunyuan-mt' }
    case 'offline-hybrid':
      return { ...base, translatorEngineId: 'hybrid' }
    case 'offline-opus':
    default:
      return { ...base, translatorEngineId: 'opus-mt' }
  }
}
