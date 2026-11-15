import { useCallback, useEffect, useState } from 'react'
import type { CharacterProfile, CharacterSettings, CharacterState } from '../../shared/character/types'

type Assets = Partial<Record<CharacterState, string>>

/**
 * Image data URLs for an imported character. Built-in characters need none,
 * so they resolve to an empty map at once; undefined means still loading.
 */
export function useCharacterProfileAssets(profile: CharacterProfile | null): Assets | undefined {
  const [loaded, setLoaded] = useState<{ key: string; assets: Assets } | null>(null)
  const isImage = profile?.appearance.kind === 'image'
  const key = profile && isImage ? JSON.stringify([profile.id, profile.appearance]) : ''

  useEffect(() => {
    if (!profile || !isImage) return
    let cancelled = false
    window.api.characterGetAssets(profile.id).then((assets) => {
      if (!cancelled) setLoaded({ key, assets })
    })
    return () => {
      cancelled = true
    }
    // key covers the profile id and its image files
  }, [key])

  if (!profile) return undefined
  if (!isImage) return EMPTY_ASSETS
  return loaded?.key === key ? loaded.assets : undefined
}

const EMPTY_ASSETS: Assets = {}

/** Character settings for the settings panel, kept in sync with main */
export function useCharacterSettings(): {
  settings: CharacterSettings | null
  save: (next: CharacterSettings) => Promise<void>
  replace: (next: CharacterSettings) => void
} {
  const [settings, setSettings] = useState<CharacterSettings | null>(null)

  useEffect(() => {
    window.api.characterGetSettings().then(setSettings)
    return window.api.onCharacterSettingsChanged(setSettings)
  }, [])

  const save = useCallback(async (next: CharacterSettings) => {
    setSettings(next)
    setSettings(await window.api.characterSaveSettings(next))
  }, [])

  return { settings, save, replace: setSettings }
}
