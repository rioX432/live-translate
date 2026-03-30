import { screen, ipcMain } from 'electron'
import type { AppContext } from '../app-context'
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

  // Forward translation result to subtitle window (from renderer)
  ipcMain.on('translation-result', (_event, data) => {
    ctx.subtitleWindow?.webContents.send('translation-result', data)
  })
}
