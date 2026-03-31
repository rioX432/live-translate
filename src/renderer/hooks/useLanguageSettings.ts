import { useEffect, useState } from 'react'
import { str } from './settingsCastUtils'
import type { Language, SourceLanguage, SttEngineType, WhisperVariantType } from '../components/settings/shared'

export interface LanguageSettingsState {
  sourceLanguage: SourceLanguage
  setSourceLanguage: (v: SourceLanguage) => void
  targetLanguage: Language
  setTargetLanguage: (v: Language) => void
  sttEngine: SttEngineType
  setSttEngine: (v: SttEngineType) => void
  whisperVariant: WhisperVariantType
  setWhisperVariant: (v: WhisperVariantType) => void
  platform: string
  draftSttEnabled: boolean
  setDraftSttEnabled: (v: boolean) => void
}

export function useLanguageSettings(): LanguageSettingsState {
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>('auto')
  const [targetLanguage, setTargetLanguage] = useState<Language>('en')
  const [sttEngine, setSttEngine] = useState<SttEngineType>('mlx-whisper')
  const [whisperVariant, setWhisperVariant] = useState<WhisperVariantType>('kotoba-v2.0')
  const [platform, setPlatform] = useState<string>('darwin')
  const [draftSttEnabled, setDraftSttEnabled] = useState(false)

  // Load language/STT settings on mount
  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (s.sttEngine) setSttEngine(str(s.sttEngine, 'mlx-whisper') as SttEngineType)
      if (s.whisperVariant) setWhisperVariant(str(s.whisperVariant, 'kotoba-v2.0') as WhisperVariantType)
      if (s.sourceLanguage) setSourceLanguage(str(s.sourceLanguage, 'auto') as SourceLanguage)
      if (s.targetLanguage) setTargetLanguage(str(s.targetLanguage, 'en') as Language)
      if (s.draftSttEnabled !== undefined) setDraftSttEnabled(!!s.draftSttEnabled)
    })

    // Set platform-aware STT default (mlx-whisper on macOS, whisper-local on Windows)
    window.api.getPlatform().then((p) => {
      setPlatform(p)
      window.api.getSettings().then((s) => {
        if (!s.sttEngine) {
          if (p === 'darwin') {
            setSttEngine('mlx-whisper')
          } else {
            setSttEngine('whisper-local')
          }
        }
      })
    }).catch((e) => console.warn('[settings] Failed to load platform/settings:', e))
  }, [])

  // Auto-select Kotoba-Whisper when source language is set to JA on Apple Silicon (#534)
  // Revert to mlx-whisper when source changes away from JA
  useEffect(() => {
    if (platform !== 'darwin') return
    if (sourceLanguage === 'ja' && sttEngine === 'mlx-whisper') {
      setSttEngine('kotoba-whisper')
    } else if (sourceLanguage !== 'ja' && sourceLanguage !== 'auto' && sttEngine === 'kotoba-whisper') {
      // Kotoba-Whisper only outputs JA — switch back to mlx-whisper for non-JA sources
      setSttEngine('mlx-whisper')
    }
  }, [sourceLanguage, platform, sttEngine])

  return {
    sourceLanguage, setSourceLanguage,
    targetLanguage, setTargetLanguage,
    sttEngine, setSttEngine,
    whisperVariant, setWhisperVariant,
    platform,
    draftSttEnabled, setDraftSttEnabled
  }
}
