import Store from 'electron-store'
import { migrateCharacterSettings, CUSTOM_PROFILE_ID_PATTERN } from '../../shared/character/settings'
import type { CharacterSettings } from '../../shared/character/types'

/**
 * Character appearance and persona live in their own file (character.json),
 * apart from translation settings and from glossary/memory, so resetting or
 * deleting a character never touches either.
 */
const characterStore = new Store<{ settings?: unknown }>({ name: 'character' })

export function loadCharacterSettings(): CharacterSettings {
  return migrateCharacterSettings(characterStore.get('settings'))
}

export function writeCharacterSettings(settings: CharacterSettings): CharacterSettings {
  const normalized = migrateCharacterSettings(settings)
  characterStore.set('settings', normalized)
  return normalized
}

/**
 * Apply settings sent by the renderer. Imported images are owned by main:
 * the renderer cannot add or remove an imported character or point it at
 * other files, so those come from the current settings. Use the import and
 * delete handlers for that.
 */
export function mergeRendererSettings(current: CharacterSettings, incoming: unknown): CharacterSettings {
  const proposed = migrateCharacterSettings(incoming)
  const currentById = new Map(current.characters.map((p) => [p.id, p]))
  const proposedById = new Map(proposed.characters.map((p) => [p.id, p]))

  const characters = current.characters.map((existing) => {
    const next = proposedById.get(existing.id)
    if (!next) return existing
    return { ...next, appearance: existing.appearance }
  })
  const activeCharacterId = currentById.has(proposed.activeCharacterId)
    ? proposed.activeCharacterId
    : current.activeCharacterId

  return migrateCharacterSettings({ ...proposed, activeCharacterId, characters })
}

export function isCustomProfileId(id: unknown): id is string {
  return typeof id === 'string' && CUSTOM_PROFILE_ID_PATTERN.test(id)
}
