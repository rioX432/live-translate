import { ipcMain } from 'electron'
import { store } from '../store'
import { getMdmConfig } from '../mdm-config'
import { getUsageSummary, getQuickStats } from '../../logger/UsageAnalytics'
import type { AppContext } from '../app-context'
import { createLogger } from '../logger'

const log = createLogger('ipc:enterprise')

/** Register enterprise feature IPC handlers (#519) */
export function registerEnterpriseIpc(_ctx: AppContext): void {
  // Usage analytics: get summary for a date range
  ipcMain.handle('enterprise-get-usage-summary', (_event, days?: number) => {
    try {
      const safeDays = typeof days === 'number' && days > 0 && days <= 365 ? days : 30
      return getUsageSummary(safeDays)
    } catch (err) {
      log.error('Failed to get usage summary:', err)
      return { error: 'Failed to load usage analytics' }
    }
  })

  // Usage analytics: quick stats (total sessions + duration)
  ipcMain.handle('enterprise-get-quick-stats', () => {
    try {
      return getQuickStats()
    } catch (err) {
      log.error('Failed to get quick stats:', err)
      return { totalSessions: 0, totalDurationMs: 0 }
    }
  })

  // MDM config: get the current managed configuration
  ipcMain.handle('enterprise-get-mdm-config', () => {
    const config = getMdmConfig()
    // Strip sensitive managed API keys from the response — renderer only needs
    // to know if they exist (not the actual values)
    return {
      lockedEngine: config.lockedEngine,
      lockedSttEngine: config.lockedSttEngine,
      telemetryDisabled: config.telemetryDisabled,
      hasManagedApiKey: config.managedApiKey !== null,
      hasManagedDeeplApiKey: config.managedDeeplApiKey !== null,
      hasManagedGeminiApiKey: config.managedGeminiApiKey !== null,
      organizationName: config.organizationName,
      autoUpdateDisabled: config.autoUpdateDisabled
    }
  })

  // Telemetry consent: get/set
  ipcMain.handle('enterprise-get-telemetry-consent', () => {
    const mdm = getMdmConfig()
    return {
      consent: mdm.telemetryDisabled ? false : (store.get('telemetryConsent') as boolean),
      consentShown: store.get('telemetryConsentShown') as boolean,
      mdmDisabled: mdm.telemetryDisabled
    }
  })

  ipcMain.handle('enterprise-set-telemetry-consent', (_event, consent: boolean) => {
    const mdm = getMdmConfig()
    if (mdm.telemetryDisabled) {
      log.warn('Telemetry consent change rejected — disabled by MDM policy')
      return { success: false, reason: 'Disabled by organization policy' }
    }
    if (typeof consent !== 'boolean') {
      return { success: false, reason: 'Invalid consent value' }
    }
    store.set('telemetryConsent', consent)
    store.set('telemetryConsentShown', true)
    log.info(`Telemetry consent set to ${consent}`)
    return { success: true }
  })
}
