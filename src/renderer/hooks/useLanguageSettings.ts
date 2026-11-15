import { useEffect, useState } from 'react'
import { str } from './settingsCastUtils'
import type { Language, SourceLanguage } from '../components/settings/shared'

export interface LanguageSettingsState {
  sourceLanguage: SourceLanguage
  setSourceLanguage: (v: SourceLanguage) => void
  targetLanguage: Language
  setTargetLanguage: (v: Language) => void
  platform: string
  speakerDiarizationEnabled: boolean
  setSpeakerDiarizationEnabled: (v: boolean) => void
}

export function useLanguageSettings(): LanguageSettingsState {
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>('auto')
  const [targetLanguage, setTargetLanguage] = useState<Language>('en')
  const [platform, setPlatform] = useState<string>('darwin')
  const [speakerDiarizationEnabled, setSpeakerDiarizationEnabled] = useState(false)

  // Load language settings on mount
  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (s.sourceLanguage) setSourceLanguage(str(s.sourceLanguage, 'auto') as SourceLanguage)
      if (s.targetLanguage) setTargetLanguage(str(s.targetLanguage, 'en') as Language)
      if (s.speakerDiarizationEnabled !== undefined) setSpeakerDiarizationEnabled(!!s.speakerDiarizationEnabled)
    })

    window.api.getPlatform()
      .then(setPlatform)
      .catch((e) => console.warn('[settings] Failed to load platform:', e))
  }, [])

  return {
    sourceLanguage, setSourceLanguage,
    targetLanguage, setTargetLanguage,
    platform,
    speakerDiarizationEnabled, setSpeakerDiarizationEnabled
  }
}
