import { ipcMain } from 'electron'
import { getShortcutLabels } from '../shortcut-manager'

/** Register keyboard shortcut IPC handlers */
export function registerShortcutIpc(): void {
  ipcMain.handle('get-shortcut-labels', () => {
    return getShortcutLabels()
  })
}
