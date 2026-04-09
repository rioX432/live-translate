import { globalShortcut, clipboard } from 'electron'
import { store } from './store'
import type { AppContext } from './app-context'
import { createLogger } from './logger'
import type { Language, SourceLanguage } from '../engines/types'

const log = createLogger('shortcuts')

/** Shortcut action identifiers */
export type ShortcutAction =
  | 'toggle-capture'
  | 'toggle-overlay'
  | 'increase-font'
  | 'decrease-font'
  | 'copy-last-subtitle'
  | 'switch-languages'
  | 'toggle-edit-mode'

/** Default shortcut accelerators (platform-aware via CommandOrControl) */
const DEFAULT_SHORTCUTS: Record<ShortcutAction, string> = {
  'toggle-capture': 'CommandOrControl+Shift+T',
  'toggle-overlay': 'CommandOrControl+Shift+O',
  'increase-font': 'CommandOrControl+Shift+=',
  'decrease-font': 'CommandOrControl+Shift+-',
  'copy-last-subtitle': 'CommandOrControl+Shift+C',
  'switch-languages': 'CommandOrControl+Shift+L',
  'toggle-edit-mode': 'CommandOrControl+Shift+E'
}

/** Common language pairs for cycling */
const LANGUAGE_PAIRS: Array<{ source: SourceLanguage; target: Language }> = [
  { source: 'ja', target: 'en' },
  { source: 'en', target: 'ja' },
  { source: 'auto', target: 'en' },
  { source: 'auto', target: 'ja' }
]

/** Last translation result for clipboard copy */
let lastSubtitleText = ''

/** Update the last subtitle text (called from pipeline result handler) */
export function setLastSubtitleText(text: string): void {
  lastSubtitleText = text
}

/** Get the configured shortcut map, merging user overrides with defaults */
function getShortcutMap(): Record<ShortcutAction, string> {
  const userShortcuts = store.get('globalShortcuts' as never) as Record<string, string> | undefined
  if (!userShortcuts) return { ...DEFAULT_SHORTCUTS }
  return { ...DEFAULT_SHORTCUTS, ...userShortcuts }
}

/**
 * Register all global keyboard shortcuts.
 * Returns a dispose function to unregister them.
 */
export function registerGlobalShortcuts(ctx: AppContext): () => void {
  const shortcuts = getShortcutMap()
  const registered: string[] = []

  function tryRegister(action: ShortcutAction, accelerator: string, handler: () => void): void {
    try {
      const success = globalShortcut.register(accelerator, handler)
      if (success) {
        registered.push(accelerator)
        log.info(`Registered shortcut: ${accelerator} -> ${action}`)
      } else {
        log.warn(`Failed to register shortcut (conflict?): ${accelerator} -> ${action}`)
      }
    } catch (err) {
      log.warn(`Error registering shortcut ${accelerator}:`, err)
    }
  }

  // Toggle capture (start/stop pipeline)
  tryRegister('toggle-capture', shortcuts['toggle-capture'], () => {
    const pipeline = ctx.pipeline
    if (!pipeline) return

    if (pipeline.active) {
      // Stop pipeline — invoke the same IPC logic the renderer uses
      ctx.mainWindow?.webContents.send('shortcut-action', 'toggle-capture-stop')
    } else {
      ctx.mainWindow?.webContents.send('shortcut-action', 'toggle-capture-start')
    }
  })

  // Toggle overlay visibility
  tryRegister('toggle-overlay', shortcuts['toggle-overlay'], () => {
    const win = ctx.subtitleWindow
    if (!win) return

    if (win.isVisible()) {
      win.hide()
      log.info('Overlay hidden via shortcut')
    } else {
      win.show()
      log.info('Overlay shown via shortcut')
    }
  })

  // Increase font size
  tryRegister('increase-font', shortcuts['increase-font'], () => {
    const settings = store.get('subtitleSettings')
    const newSize = Math.min(settings.fontSize + 2, 60)
    if (newSize === settings.fontSize) return
    store.set('subtitleSettings', { ...settings, fontSize: newSize })
    ctx.subtitleWindow?.webContents.send('subtitle-settings-changed', { ...settings, fontSize: newSize })
    ctx.mainWindow?.webContents.send('subtitle-settings-changed', { ...settings, fontSize: newSize })
    log.info(`Font size increased to ${newSize}`)
  })

  // Decrease font size
  tryRegister('decrease-font', shortcuts['decrease-font'], () => {
    const settings = store.get('subtitleSettings')
    const newSize = Math.max(settings.fontSize - 2, 14)
    if (newSize === settings.fontSize) return
    store.set('subtitleSettings', { ...settings, fontSize: newSize })
    ctx.subtitleWindow?.webContents.send('subtitle-settings-changed', { ...settings, fontSize: newSize })
    ctx.mainWindow?.webContents.send('subtitle-settings-changed', { ...settings, fontSize: newSize })
    log.info(`Font size decreased to ${newSize}`)
  })

  // Copy last subtitle to clipboard
  tryRegister('copy-last-subtitle', shortcuts['copy-last-subtitle'], () => {
    if (lastSubtitleText) {
      clipboard.writeText(lastSubtitleText)
      log.info('Copied last subtitle to clipboard')
      ctx.mainWindow?.webContents.send('status-update', 'Copied subtitle to clipboard')
    }
  })

  // Switch language pair
  tryRegister('switch-languages', shortcuts['switch-languages'], () => {
    const currentSource = store.get('sourceLanguage')
    const currentTarget = store.get('targetLanguage')

    // Find current pair index, then advance to next
    const currentIdx = LANGUAGE_PAIRS.findIndex(
      (p) => p.source === currentSource && p.target === currentTarget
    )
    const nextIdx = (currentIdx + 1) % LANGUAGE_PAIRS.length
    const next = LANGUAGE_PAIRS[nextIdx]

    store.set('sourceLanguage', next.source)
    store.set('targetLanguage', next.target)

    // Notify pipeline of language change
    ctx.pipeline?.setLanguageConfig(next.source, next.target)

    // Notify renderer to update UI
    ctx.mainWindow?.webContents.send('language-switched', {
      sourceLanguage: next.source,
      targetLanguage: next.target
    })
    ctx.mainWindow?.webContents.send('status-update',
      `Language: ${next.source} -> ${next.target}`)

    log.info(`Switched languages to ${next.source} -> ${next.target}`)
  })

  // Toggle edit mode on subtitle overlay (#590)
  let editModeEnabled = false
  tryRegister('toggle-edit-mode', shortcuts['toggle-edit-mode'], () => {
    const win = ctx.subtitleWindow
    if (!win) return

    editModeEnabled = !editModeEnabled
    if (editModeEnabled) {
      win.setIgnoreMouseEvents(false)
    } else {
      win.setIgnoreMouseEvents(true, { forward: true })
    }
    win.webContents.send('edit-mode-changed', editModeEnabled)
    ctx.mainWindow?.webContents.send('edit-mode-changed', editModeEnabled)
    ctx.mainWindow?.webContents.send('status-update',
      editModeEnabled ? 'Edit mode enabled — click translations to correct' : 'Edit mode disabled')
    log.info(`Edit mode ${editModeEnabled ? 'enabled' : 'disabled'} via shortcut`)
  })

  return () => {
    for (const accelerator of registered) {
      globalShortcut.unregister(accelerator)
    }
    log.info(`Unregistered ${registered.length} global shortcuts`)
  }
}

/** Get the default shortcut map for display in settings UI */
export function getDefaultShortcuts(): Record<ShortcutAction, string> {
  return { ...DEFAULT_SHORTCUTS }
}

/** Get human-readable shortcut labels (Cmd/Ctrl based on platform) */
export function getShortcutLabels(): Record<ShortcutAction, { action: string; shortcut: string }> {
  const mod = process.platform === 'darwin' ? 'Cmd' : 'Ctrl'
  return {
    'toggle-capture': { action: 'Toggle capture', shortcut: `${mod}+Shift+T` },
    'toggle-overlay': { action: 'Toggle overlay', shortcut: `${mod}+Shift+O` },
    'increase-font': { action: 'Increase font', shortcut: `${mod}+Shift+=` },
    'decrease-font': { action: 'Decrease font', shortcut: `${mod}+Shift+-` },
    'copy-last-subtitle': { action: 'Copy last subtitle', shortcut: `${mod}+Shift+C` },
    'switch-languages': { action: 'Switch languages', shortcut: `${mod}+Shift+L` },
    'toggle-edit-mode': { action: 'Toggle edit mode', shortcut: `${mod}+Shift+E` }
  }
}
