import { ipcMain } from 'electron'
import { store } from '../store'
import {
  getOnboardingStatus,
  startOnboardingDownload,
  isTier1Ready,
  isTier2Ready,
  getTier1EngineConfig,
  getTier2EngineConfig
} from '../onboarding-downloader'
import type { AppContext } from '../app-context'
import { createLogger } from '../logger'

const log = createLogger('ipc:onboarding')

/** Register onboarding IPC handlers for progressive model loading (#575, #694) */
export function registerOnboardingIpc(ctx: AppContext): void {
  // Get current progressive download status
  ipcMain.handle('onboarding-get-status', () => {
    return getOnboardingStatus()
  })

  // Start progressive background download (Tier 1 → Tier 2)
  ipcMain.handle('onboarding-start-download', async () => {
    const engineMode = await startOnboardingDownload(ctx.mainWindow)
    if (engineMode) {
      return { success: true, engineMode }
    }
    return { success: false }
  })

  // Switch to Tier 1 (basic offline) engine after Tier 1 download completes
  ipcMain.handle('onboarding-switch-to-local', async () => {
    if (!isTier1Ready()) {
      return { error: 'Tier 1 models not yet downloaded' }
    }

    const tier1Config = getTier1EngineConfig()
    if (!tier1Config) {
      return { error: 'Tier 1 engine configuration unavailable' }
    }

    store.set('translationEngine', tier1Config.engineMode)
    store.set('sttEngine', tier1Config.sttEngineId)
    store.set('whisperVariant', tier1Config.whisperVariant)
    store.set('activeModelTier', 1)
    // Don't set isFirstRun=false yet — Tier 2 may still need to download
    log.info(`Onboarding: switched to Tier 1 (${tier1Config.engineMode}, STT: ${tier1Config.sttEngineId})`)
    return { success: true, engine: tier1Config.engineMode, tier: 1 }
  })

  // Upgrade to Tier 2 (full-quality) engine after Tier 2 download completes
  ipcMain.handle('onboarding-upgrade-to-tier2', async () => {
    if (!isTier2Ready()) {
      return { error: 'Tier 2 models not yet downloaded' }
    }

    const tier2Config = getTier2EngineConfig()
    if (!tier2Config) {
      return { error: 'Tier 2 engine configuration unavailable' }
    }

    store.set('translationEngine', tier2Config.engineMode)
    store.set('sttEngine', tier2Config.sttEngineId)
    store.set('whisperVariant', tier2Config.whisperVariant)
    store.set('activeModelTier', 2)
    store.set('isFirstRun', false)
    log.info(`Onboarding: upgraded to Tier 2 (${tier2Config.engineMode}, STT: ${tier2Config.sttEngineId})`)
    return { success: true, engine: tier2Config.engineMode, tier: 2 }
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
