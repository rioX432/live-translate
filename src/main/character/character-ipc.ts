import { dialog, ipcMain } from 'electron'
import { createLogger } from '../logger'
import { CHARACTER_STATES, type CharacterState } from '../../shared/character/types'
import { defaultProfile, CHARACTER_PROFILES_MAX } from '../../shared/character/settings'
import { mergeRendererSettings, isCustomProfileId } from './character-store'
import {
  importCharacterImage,
  readCharacterAssets,
  removeCharacterAsset,
  removeProfileAssets,
  newCustomProfileId,
  IMPORT_FILE_EXTENSIONS
} from './character-assets'
import type { CharacterController } from './character-controller'

const log = createLogger('character-ipc')

function isState(v: unknown): v is CharacterState {
  return typeof v === 'string' && (CHARACTER_STATES as readonly string[]).includes(v)
}

export function registerCharacterIpc(controller: CharacterController, getDialogParent: () => Electron.BrowserWindow | null): void {
  ipcMain.handle('character-get-settings', () => controller.getSettings())
  ipcMain.handle('character-get-status', () => controller.getStatus())
  ipcMain.handle('character-get-app-reduced-motion', () => controller.getAppReducedMotion())

  ipcMain.handle('character-save-settings', (_event, incoming: unknown) => {
    return controller.updateSettings(mergeRendererSettings(controller.getSettings(), incoming))
  })

  ipcMain.handle('character-reset-position', () => controller.resetPosition())

  /**
   * Pick an image and either create a new character from it (no profileId)
   * or replace one state's image of an existing imported character.
   */
  ipcMain.handle('character-import-image', async (_event, request: unknown) => {
    const req = (typeof request === 'object' && request !== null ? request : {}) as { profileId?: unknown; state?: unknown }
    const state: CharacterState = isState(req.state) ? req.state : 'idle'
    const current = controller.getSettings()
    const target = req.profileId === undefined ? null : current.characters.find((p) => p.id === req.profileId)
    if (req.profileId !== undefined && (!target || target.appearance.kind !== 'image')) {
      return { error: 'Only imported characters can change their images' }
    }
    if (!target && current.characters.length >= CHARACTER_PROFILES_MAX) {
      return { error: `Up to ${CHARACTER_PROFILES_MAX} characters can be saved` }
    }

    const parent = getDialogParent()
    const options: Electron.OpenDialogOptions = {
      title: 'Choose a character image',
      filters: [{ name: 'Images', extensions: IMPORT_FILE_EXTENSIONS }],
      properties: ['openFile']
    }
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) return { canceled: true }

    const profileId = target ? target.id : newCustomProfileId()
    try {
      const result = await importCharacterImage(picked.filePaths[0], profileId, state)
      if ('error' in result) return result

      if (target && target.appearance.kind === 'image') {
        const previous = target.appearance.assets[state]
        const appearance = { ...target.appearance, assets: { ...target.appearance.assets, [state]: result.fileName } }
        const characters = current.characters.map((p) => (p.id === target.id ? { ...p, appearance } : p))
        const settings = controller.updateSettings({ ...current, characters })
        if (previous && previous !== result.fileName) await removeCharacterAsset(target.id, previous)
        return { settings }
      }

      const profile = defaultProfile(profileId, 'My character', {
        kind: 'image',
        assets: { idle: result.fileName },
        pixelArt: false
      })
      const settings = controller.updateSettings({
        ...current,
        activeCharacterId: profileId,
        characters: [...current.characters, profile]
      })
      return { settings }
    } catch (err) {
      // File paths can contain the user's name; log only the error kind
      log.error('Character image import failed:', err instanceof Error ? err.name : 'unknown')
      if (!target) await removeProfileAssets(profileId).catch(() => undefined)
      return { error: 'Could not import the image' }
    }
  })

  ipcMain.handle('character-delete', async (_event, profileId: unknown) => {
    if (!isCustomProfileId(profileId)) return { error: 'Built-in characters cannot be deleted' }
    const current = controller.getSettings()
    const characters = current.characters.filter((p) => p.id !== profileId)
    const settings = controller.updateSettings({ ...current, characters })
    await removeProfileAssets(profileId).catch((err) => {
      log.error('Removing character files failed:', err instanceof Error ? err.name : 'unknown')
    })
    return { settings }
  })

  ipcMain.handle('character-get-assets', async (_event, profileId: unknown) => {
    const profile = controller.getSettings().characters.find((p) => p.id === profileId)
    if (!profile || profile.appearance.kind !== 'image') return {}
    return readCharacterAssets(profile.id, profile.appearance.assets)
  })

  // Overlay-only channels: ignore anything not sent by the character window
  ipcMain.on('character-set-interactive', (event, interactive: unknown) => {
    if (controller.isCharacterWindow(event.sender)) controller.setInteractive(interactive === true)
  })
  ipcMain.on('character-move-by', (event, delta: unknown) => {
    if (!controller.isCharacterWindow(event.sender)) return
    const d = (typeof delta === 'object' && delta !== null ? delta : {}) as { dx?: unknown; dy?: unknown }
    if (typeof d.dx === 'number' && typeof d.dy === 'number') controller.moveBy(d.dx, d.dy)
  })
  ipcMain.on('character-drag-end', (event) => {
    if (controller.isCharacterWindow(event.sender)) controller.dragEnd()
  })
}
