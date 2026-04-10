import { autoUpdater } from 'electron-updater'
import type { UpdateInfo, ProgressInfo } from 'electron-updater'
import { ipcMain } from 'electron'
import { createLogger } from './logger'
import type { AppContext } from './app-context'

const log = createLogger('auto-updater')

/** Check interval: 4 hours */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  progress?: number
  error?: string
}

let currentStatus: UpdateStatus = { state: 'idle' }
let checkTimer: ReturnType<typeof setInterval> | null = null

function sendStatus(ctx: AppContext, status: UpdateStatus): void {
  currentStatus = status
  ctx.mainWindow?.webContents.send('update-status', status)
}

/**
 * Initialize auto-updater with event handlers and periodic checks.
 * Must be called after app.whenReady() and window creation.
 */
export function initAutoUpdater(ctx: AppContext): void {
  // Skip auto-updater for unsigned/local builds — app-update.yml won't exist
  const { app } = require('electron')
  if (!app.isPackaged) {
    log.info('Dev mode — skipping auto-updater')
    return
  }
  const { existsSync } = require('fs')
  const { join } = require('path')
  if (!existsSync(join(process.resourcesPath, 'app-update.yml'))) {
    log.info('No app-update.yml — skipping auto-updater (unsigned build)')
    return
  }

  // Disable auto-download — let user decide when to install
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    log.info('Checking for updates...')
    sendStatus(ctx, { state: 'checking' })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    log.info('Update available:', info.version)
    sendStatus(ctx, { state: 'available', version: info.version })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    log.info('Up to date:', info.version)
    sendStatus(ctx, { state: 'not-available', version: info.version })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    sendStatus(ctx, {
      state: 'downloading',
      progress: Math.round(progress.percent)
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    log.info('Update downloaded:', info.version)
    sendStatus(ctx, { state: 'downloaded', version: info.version })
  })

  autoUpdater.on('error', (err: Error) => {
    log.error('Update error:', err.message)
    sendStatus(ctx, { state: 'error', error: err.message })
  })

  // Check on launch (with a small delay to not block startup)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn('Initial update check failed:', err.message)
    })
  }, 10_000)

  // Periodic check
  checkTimer = setInterval(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.warn('Periodic update check failed:', err.message)
    })
  }, CHECK_INTERVAL_MS)
}

/** Register IPC handlers for update actions */
export function registerUpdateHandlers(ctx: AppContext): void {
  ipcMain.handle('update-check', async () => {
    try {
      await autoUpdater.checkForUpdates()
      return { success: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('update-download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle('update-install', () => {
    // Quit and install — deferred if pipeline is running
    if (ctx.pipeline?.running) {
      log.info('Pipeline is running, deferring restart until quit')
      // autoInstallOnAppQuit is true, so it will install on next quit
      return { deferred: true }
    }
    autoUpdater.quitAndInstall()
    return { success: true }
  })

  ipcMain.handle('update-get-status', () => {
    return currentStatus
  })
}

/** Clean up timer and listeners on app quit */
export function disposeAutoUpdater(): void {
  if (checkTimer) {
    clearInterval(checkTimer)
    checkTimer = null
  }
  autoUpdater.removeAllListeners()
}
