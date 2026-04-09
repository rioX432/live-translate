import { screen, ipcMain } from 'electron'
import type { AppContext } from '../app-context'
import { store } from '../store'
import { getSubtitleHeight } from '../window-manager'
import { createLogger } from '../logger'

const log = createLogger('ipc:display')

/** Register display and subtitle window IPC handlers */
export function registerDisplayIpc(ctx: AppContext): void {
  ipcMain.handle('get-displays', () => {
    const primary = screen.getPrimaryDisplay()
    return screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      label: d.id === primary.id ? `Display ${i + 1} (Main)` : `Display ${i + 1} (External)`,
      bounds: d.bounds
    }))
  })

  ipcMain.on('move-subtitle-to-display', (_event, displayId: number) => {
    const display = screen.getAllDisplays().find((d) => d.id === displayId)
    if (!display) {
      log.warn(`Display ${displayId} not found, ignoring move request`)
      return
    }
    if (ctx.subtitleWindow) {
      const h = getSubtitleHeight(display)
      ctx.subtitleWindow.setBounds({
        x: display.bounds.x,
        y: display.bounds.y + display.bounds.height - h,
        width: display.bounds.width,
        height: h
      })
    }
  })

  // Toggle subtitle drag mode (#509): disable click-through so user can drag
  ipcMain.handle('toggle-subtitle-drag-mode', (_event, enabled: boolean) => {
    if (!ctx.subtitleWindow) return
    if (enabled) {
      ctx.subtitleWindow.setIgnoreMouseEvents(false)
    } else {
      ctx.subtitleWindow.setIgnoreMouseEvents(true, { forward: true })
    }
    ctx.subtitleWindow.webContents.send('drag-mode-changed', enabled)
  })

  // Move subtitle window by pixel delta (#509)
  ipcMain.on('move-subtitle-by-delta', (_event, dx: number, dy: number) => {
    if (!ctx.subtitleWindow) return
    const [x, y] = ctx.subtitleWindow.getPosition()
    ctx.subtitleWindow.setPosition(x + dx, y + dy)
  })

  // Save current subtitle window position to electron-store keyed by display ID (#509)
  ipcMain.handle('save-subtitle-position', () => {
    if (!ctx.subtitleWindow) return
    const bounds = ctx.subtitleWindow.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const positions = (store.get('subtitlePositions' as never) as Record<string, { x: number; y: number }> | undefined) || {}
    positions[String(display.id)] = { x: bounds.x, y: bounds.y }
    store.set('subtitlePositions' as never, positions as never)
    log.info(`Saved subtitle position for display ${display.id}: (${bounds.x}, ${bounds.y})`)
  })

  // Reset subtitle position to default for the current display (#509)
  ipcMain.handle('reset-subtitle-position', () => {
    if (!ctx.subtitleWindow) return
    const bounds = ctx.subtitleWindow.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const h = getSubtitleHeight(display)
    ctx.subtitleWindow.setBounds({
      x: display.bounds.x,
      y: display.bounds.y + display.bounds.height - h,
      width: display.bounds.width,
      height: h
    })
    // Remove saved position for this display
    const positions = (store.get('subtitlePositions' as never) as Record<string, { x: number; y: number }> | undefined) || {}
    delete positions[String(display.id)]
    store.set('subtitlePositions' as never, positions as never)
    log.info(`Reset subtitle position for display ${display.id}`)
  })

  // Toggle subtitle edit mode (#590): disable click-through so user can edit translations
  ipcMain.handle('toggle-subtitle-edit-mode', (_event, enabled: boolean) => {
    if (!ctx.subtitleWindow) return
    if (enabled) {
      ctx.subtitleWindow.setIgnoreMouseEvents(false)
    } else {
      ctx.subtitleWindow.setIgnoreMouseEvents(true, { forward: true })
    }
    ctx.subtitleWindow.webContents.send('edit-mode-changed', enabled)
    ctx.mainWindow?.webContents.send('edit-mode-changed', enabled)
    log.info(`Subtitle edit mode ${enabled ? 'enabled' : 'disabled'}`)
  })

  // Forward translation result to subtitle window (from renderer)
  ipcMain.on('translation-result', (_event, data) => {
    ctx.subtitleWindow?.webContents.send('translation-result', data)
  })
}
