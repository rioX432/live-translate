import { ipcMain } from 'electron'
import type { AppContext } from '../app-context'
import { store } from '../store'
import { createLogger } from '../logger'

const log = createLogger('ipc:virtual-mic')

/** Register virtual mic IPC handlers (#515) */
export function registerVirtualMicIpc(ctx: AppContext): void {
  // Get virtual mic status (available devices, enabled state)
  ipcMain.handle('virtual-mic-get-status', () => {
    if (!ctx.virtualMicManager) {
      return {
        enabled: false,
        activeDeviceId: null,
        activeDeviceName: null,
        availableDevices: []
      }
    }
    return ctx.virtualMicManager.getStatus()
  })

  // Enable virtual mic output to a specific device
  ipcMain.handle('virtual-mic-enable', async (_event, deviceId: number) => {
    try {
      if (!ctx.virtualMicManager) {
        return { error: 'Virtual mic manager not initialized' }
      }
      if (typeof deviceId !== 'number' || !Number.isInteger(deviceId) || deviceId < 0) {
        return { error: 'Invalid device ID' }
      }
      await ctx.virtualMicManager.enable(deviceId)
      store.set('virtualMicEnabled', true)
      store.set('virtualMicDeviceId', deviceId)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('Failed to enable virtual mic:', msg)
      return { error: msg }
    }
  })

  // Disable virtual mic output
  ipcMain.handle('virtual-mic-disable', async () => {
    try {
      if (!ctx.virtualMicManager) return { success: true }
      await ctx.virtualMicManager.disable()
      store.set('virtualMicEnabled', false)
      return { success: true }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error('Failed to disable virtual mic:', msg)
      return { error: msg }
    }
  })

  // Refresh device list (e.g. after user installs BlackHole)
  ipcMain.handle('virtual-mic-refresh-devices', () => {
    if (!ctx.virtualMicManager) return []
    return ctx.virtualMicManager.listVirtualDevices()
  })
}
