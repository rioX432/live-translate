import { ipcMain } from 'electron'
import { store } from '../store'
import {
  getOnboardingStatus,
  startOnboardingDownload,
  isOnboardingModelReady
} from '../onboarding-downloader'
import type { AppContext } from '../app-context'
import { createLogger } from '../logger'

const log = createLogger('ipc:onboarding')

/** Register onboarding IPC handlers for cloud-first progressive download (#575) */
export function registerOnboardingIpc(ctx: AppContext): void {
  // Get current onboarding download status
  ipcMain.handle('onboarding-get-status', () => {
    return getOnboardingStatus()
  })

  // Start background model download
  ipcMain.handle('onboarding-start-download', async () => {
    const engineMode = await startOnboardingDownload(ctx.mainWindow)
    if (engineMode) {
      return { success: true, engineMode }
    }
    return { success: false }
  })

  // Switch to local engine after download completes
  ipcMain.handle('onboarding-switch-to-local', async () => {
    if (!isOnboardingModelReady()) {
      return { error: 'Local model not yet downloaded' }
    }

    const preferred = store.get('preferredLocalEngine')
    store.set('translationEngine', preferred)
    store.set('isFirstRun', false)
    log.info(`Onboarding: switched to local engine ${preferred}`)
    return { success: true, engine: preferred }
  })

  // Dismiss onboarding (user wants to stay on current engine)
  ipcMain.handle('onboarding-dismiss', () => {
    store.set('isFirstRun', false)
    log.info('Onboarding dismissed by user')
    return { success: true }
  })

  // Set preferred local engine for download
  ipcMain.handle('onboarding-set-preferred-engine', (_event, engine: string) => {
    const validEngines = ['offline-hymt15', 'offline-lfm2']
    if (!validEngines.includes(engine)) {
      return { error: `Invalid engine: ${engine}` }
    }
    store.set('preferredLocalEngine', engine)
    log.info(`Onboarding: preferred engine set to ${engine}`)
    return { success: true }
  })

  // Check if this is a fresh install
  ipcMain.handle('onboarding-is-first-run', () => {
    return store.get('isFirstRun')
  })
}
