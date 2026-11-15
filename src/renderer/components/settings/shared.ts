import React from 'react'
import { colors, fontSize } from '../../theme'

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

export type EngineMode = 'auto'

/** Translation engine IDs persisted by older versions. 'auto' is the only value left;
 *  matching store values are migrated to it on startup. */
export const LEGACY_TRANSLATION_ENGINES: readonly string[] = [
  'offline-lfm2',
  'offline-plamo',
  'offline-hybrid',
  'offline-opus',
  'rotation',
  'online',
  'online-deepl',
  'online-gemini',
  'offline-hymt15',
  'offline-hunyuan-mt',
  'offline-apple'
] as const

/** STT engines main picks between (src/engines/engine-selection.ts) */
export type SttEngineType = 'qwen3-asr' | 'whisper-local'
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
  fontSize: fontSize.md,
  background: colors.bg.secondary,
  color: colors.text.primary,
  border: `1px solid ${colors.border.default}`,
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
  fontSize: fontSize.md,
  color: colors.text.primary,
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
  marginTop: '8px',
  minHeight: '44px'
}

export const sliderLabelStyle: React.CSSProperties = {
  fontSize: fontSize.base,
  color: colors.text.muted,
  marginBottom: '4px'
}

export const colorInputStyle: React.CSSProperties = {
  width: '100%',
  height: '2rem',
  padding: '2px',
  background: colors.bg.secondary,
  border: `1px solid ${colors.border.default}`,
  borderRadius: '6px',
  cursor: 'pointer'
}

export const errorContainerStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: fontSize.base,
  color: '#fca5a5',
  background: colors.bg.secondary,
  border: `1px solid ${colors.accent.error}`,
  borderRadius: '6px',
  marginBottom: '8px'
}

export const warningContainerStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: fontSize.base,
  color: '#fde68a',
  background: colors.bg.secondary,
  border: `1px solid ${colors.accent.warning}`,
  borderRadius: '6px',
  marginBottom: '8px'
}

export const disclosureToggleStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: colors.text.secondary,
  fontSize: fontSize.sm,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  cursor: 'pointer',
  padding: '4px 0',
  display: 'flex',
  alignItems: 'center',
  gap: '6px'
}

export const disclosureArrowStyle = (isOpen: boolean): React.CSSProperties => ({
  transform: isOpen ? 'rotate(90deg)' : 'none',
  transition: 'transform 0.2s',
  fontSize: fontSize.xs
})

// --- Engine utilities ---

/** Display name for the STT engine main runs on this platform */
export function getSttDisplayName(sttEngine: SttEngineType): string {
  return sttEngine === 'qwen3-asr' ? 'Qwen3-ASR 0.6B' : 'Whisper large-v3-turbo'
}

export const TRANSLATOR_DISPLAY_NAME = 'Hy-MT2 1.8B'

/** Pipeline config sent on start; main replaces the engine IDs with its own selection. */
export function buildEngineConfig(sttEngine: SttEngineType): Record<string, unknown> {
  return { mode: 'cascade' as const, sttEngineId: sttEngine, translatorEngineId: 'hy-mt2' }
}
