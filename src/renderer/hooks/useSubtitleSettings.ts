import { useEffect, useState } from 'react'
import { bool, num, rec, str } from './settingsCastUtils'
import type { SubtitlePositionType } from '../components/settings/shared'

export interface SubtitleSettingsState {
  subtitleFontSize: number
  setSubtitleFontSize: (v: number) => void
  subtitleSourceColor: string
  setSubtitleSourceColor: (v: string) => void
  subtitleTranslatedColor: string
  setSubtitleTranslatedColor: (v: string) => void
  subtitleBgOpacity: number
  setSubtitleBgOpacity: (v: number) => void
  subtitlePosition: SubtitlePositionType
  setSubtitlePosition: (v: SubtitlePositionType) => void
  showConfidenceIndicator: boolean
  setShowConfidenceIndicator: (v: boolean) => void
  pushSubtitleSettings: (overrides?: Record<string, unknown>) => void
}

export function useSubtitleSettings(): SubtitleSettingsState {
  const [subtitleFontSize, setSubtitleFontSize] = useState(30)
  const [subtitleSourceColor, setSubtitleSourceColor] = useState('#ffffff')
  const [subtitleTranslatedColor, setSubtitleTranslatedColor] = useState('#7dd3fc')
  const [subtitleBgOpacity, setSubtitleBgOpacity] = useState(78)
  const [subtitlePosition, setSubtitlePosition] = useState<SubtitlePositionType>('bottom')
  const [showConfidenceIndicator, setShowConfidenceIndicator] = useState(true)

  // Load subtitle settings on mount
  useEffect(() => {
    window.api.getSettings().then((s) => {
      const sub = rec(s.subtitleSettings)
      if (sub) {
        if (sub.fontSize) setSubtitleFontSize(num(sub.fontSize, 30))
        if (sub.sourceTextColor) setSubtitleSourceColor(str(sub.sourceTextColor, '#ffffff'))
        if (sub.translatedTextColor) setSubtitleTranslatedColor(str(sub.translatedTextColor, '#7dd3fc'))
        if (sub.backgroundOpacity !== undefined) setSubtitleBgOpacity(num(sub.backgroundOpacity, 78))
        if (sub.position) setSubtitlePosition(str(sub.position, 'bottom') as SubtitlePositionType)
      }
      if (s.showConfidenceIndicator !== undefined) {
        setShowConfidenceIndicator(bool(s.showConfidenceIndicator, true))
      }
    })
  }, [])

  const pushSubtitleSettings = (overrides: Record<string, unknown> = {}): void => {
    const settings = {
      fontSize: subtitleFontSize,
      sourceTextColor: subtitleSourceColor,
      translatedTextColor: subtitleTranslatedColor,
      backgroundOpacity: subtitleBgOpacity,
      position: subtitlePosition,
      ...overrides
    }
    window.api.saveSubtitleSettings(settings)
  }

  return {
    subtitleFontSize, setSubtitleFontSize,
    subtitleSourceColor, setSubtitleSourceColor,
    subtitleTranslatedColor, setSubtitleTranslatedColor,
    subtitleBgOpacity, setSubtitleBgOpacity,
    subtitlePosition, setSubtitlePosition,
    showConfidenceIndicator, setShowConfidenceIndicator,
    pushSubtitleSettings
  }
}
