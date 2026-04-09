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
  /** Whether the current system is macOS 26+ (Tahoe), enabling Apple SpeechTranscriber */
  isMacOS26: boolean
  draftSttEnabled: boolean
  setDraftSttEnabled: (v: boolean) => void
  speakerDiarizationEnabled: boolean
  setSpeakerDiarizationEnabled: (v: boolean) => void
}

export function useLanguageSettings(): LanguageSettingsState {
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>('auto')
  const [targetLanguage, setTargetLanguage] = useState<Language>('en')
  const [sttEngine, setSttEngine] = useState<SttEngineType>('mlx-whisper')
  const [whisperVariant, setWhisperVariant] = useState<WhisperVariantType>('kotoba-v2.0')
  const [platform, setPlatform] = useState<string>('darwin')
  const [isMacOS26, setIsMacOS26] = useState(false)
  const [draftSttEnabled, setDraftSttEnabled] = useState(false)
  const [speakerDiarizationEnabled, setSpeakerDiarizationEnabled] = useState(false)

  // Load language/STT settings on mount
  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (s.sttEngine) setSttEngine(str(s.sttEngine, 'mlx-whisper') as SttEngineType)
      if (s.whisperVariant) setWhisperVariant(str(s.whisperVariant, 'kotoba-v2.0') as WhisperVariantType)
      if (s.sourceLanguage) setSourceLanguage(str(s.sourceLanguage, 'auto') as SourceLanguage)
      if (s.targetLanguage) setTargetLanguage(str(s.targetLanguage, 'en') as Language)
      if (s.draftSttEnabled !== undefined) setDraftSttEnabled(!!s.draftSttEnabled)
      if (s.speakerDiarizationEnabled !== undefined) setSpeakerDiarizationEnabled(!!s.speakerDiarizationEnabled)
    })

    // Set platform-aware STT default and detect macOS version
    Promise.all([
      window.api.getPlatform(),
      window.api.getMacOSVersion()
    ]).then(([p, macVer]) => {
      setPlatform(p)
      // macOS 26+ (Tahoe) enables Apple SpeechTranscriber as primary STT (#548)
      const isTahoe = macVer !== null && parseInt(macVer.split('.')[0], 10) >= 26
      setIsMacOS26(isTahoe)
      window.api.getSettings().then((s) => {
        if (!s.sttEngine) {
          if (isTahoe) {
            // Default to Apple SpeechTranscriber on macOS 26+ — zero setup required
            setSttEngine('apple-speech-transcriber')
          } else if (p === 'darwin') {
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
    isMacOS26,
    draftSttEnabled, setDraftSttEnabled,
    speakerDiarizationEnabled, setSpeakerDiarizationEnabled
  }
}
