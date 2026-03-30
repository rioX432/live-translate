import { useEffect, useRef, useState } from 'react'
import { num } from './settingsCastUtils'
import type { DisplayInfo } from '../components/settings/shared'

export interface DisplaySettingsState {
  displays: DisplayInfo[]
  selectedDisplay: number
  handleDisplayChange: (displayId: number) => void
}

export function useDisplaySettings(): DisplaySettingsState {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const [selectedDisplay, setSelectedDisplay] = useState<number>(0)

  // Guard: display-related callbacks must wait until settings are fully loaded
  const settingsLoadedRef = useRef(false)
  const selectedDisplayRef = useRef(selectedDisplay)

  // Load saved display selection on mount
  useEffect(() => {
    window.api.getSettings().then((s) => {
      if (s.selectedDisplay !== undefined) {
        const savedDisplay = num(s.selectedDisplay, 0)
        setSelectedDisplay(savedDisplay)
        selectedDisplayRef.current = savedDisplay
      }
      settingsLoadedRef.current = true
    })
  }, [])

  // Load displays and listen for display changes
  useEffect(() => {
    const refreshDisplays = (): void => {
      window.api.getDisplays().then((d) => {
        setDisplays(d)
        // Skip auto-selection until settings are loaded (saved value takes priority)
        if (!settingsLoadedRef.current) return
        // Only auto-select if the current display was disconnected
        const currentStillExists = d.some((disp: DisplayInfo) => disp.id === selectedDisplayRef.current)
        if (!currentStillExists) {
          const external = d.find((disp: DisplayInfo) => disp.label.includes('External'))
          const fallback = external?.id ?? d[0]?.id ?? 0
          setSelectedDisplay(fallback)
          selectedDisplayRef.current = fallback
        }
      })
    }
    refreshDisplays()
    const unsubscribe = window.api.onDisplaysChanged(refreshDisplays)
    return () => unsubscribe?.()
  }, [])

  const handleDisplayChange = (displayId: number): void => {
    setSelectedDisplay(displayId)
    selectedDisplayRef.current = displayId
    window.api.moveSubtitleToDisplay(displayId)
  }

  return { displays, selectedDisplay, handleDisplayChange }
}
