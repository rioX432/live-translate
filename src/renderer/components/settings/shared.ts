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

export type EngineMode = 'auto' | 'rotation' | 'online' | 'online-deepl' | 'online-gemini' | 'offline-opus' | 'offline-ct2-opus' | 'offline-madlad-400' | 'offline-slm' | 'offline-hunyuan-mt' | 'offline-hunyuan-mt-15' | 'offline-ane' | 'offline-hybrid'

export type SttEngineType = 'whisper-local' | 'mlx-whisper' | 'moonshine' | 'sensevoice' | 'sherpa-onnx'
export type SherpaOnnxPresetType = 'whisper-tiny' | 'whisper-base' | 'whisper-small' | 'sensevoice' | 'paraformer'
export type WhisperVariantType = 'kotoba-v2.0' | 'large-v3-turbo'
export type MoonshineVariantType = 'tiny' | 'base'
export type SlmModelSizeType = '4b' | '12b'
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
