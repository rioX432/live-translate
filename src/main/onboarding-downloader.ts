import { store } from './store'
import { createLogger } from './logger'
import {
  isGGUFDownloaded,
  downloadGGUF,
  getHunyuanMT15Variants,
  getLFM2Variants
} from '../engines/model-downloader'
import type { BrowserWindow } from 'electron'

const log = createLogger('onboarding-downloader')

/** Model target configuration for onboarding download */
interface OnboardingTarget {
  engineId: string
  engineMode: string
  filename: string
  url: string
  sha256?: string
  sizeMB: number
  label: string
}

/** Get the target model for onboarding based on preferred engine */
function getOnboardingTarget(): OnboardingTarget | null {
  const preferred = store.get('preferredLocalEngine')

  if (preferred === 'offline-lfm2') {
    const variants = getLFM2Variants()
    const v = variants['Q4_K_M']
    if (!v) return null
    return {
      engineId: 'lfm2',
      engineMode: 'offline-lfm2',
      filename: v.filename,
      url: v.url,
      sizeMB: v.sizeMB,
      label: 'LFM2-350M'
    }
  }

  // Default: HY-MT1.5-1.8B
  const variants = getHunyuanMT15Variants()
  const v = variants['Q4_K_M']
  if (!v) return null
  return {
    engineId: 'hunyuan-mt-15',
    engineMode: 'offline-hymt15',
    filename: v.filename,
    url: v.url,
    sizeMB: v.sizeMB,
    label: 'HY-MT1.5-1.8B'
  }
}

/** Check if the preferred local model is already downloaded */
export function isOnboardingModelReady(): boolean {
  const target = getOnboardingTarget()
  if (!target) return false
  return isGGUFDownloaded(target.filename)
}

/** Get onboarding download status for renderer */
export function getOnboardingStatus(): {
  status: string
  progress: number
  preferredEngine: string
  modelReady: boolean
  targetLabel: string
  targetSizeMB: number
} {
  const target = getOnboardingTarget()
  return {
    status: store.get('onboardingModelStatus'),
    progress: store.get('onboardingDownloadProgress'),
    preferredEngine: store.get('preferredLocalEngine'),
    modelReady: target ? isGGUFDownloaded(target.filename) : false,
    targetLabel: target?.label ?? 'Unknown',
    targetSizeMB: target?.sizeMB ?? 0
  }
}

/**
 * Start background download of the preferred local translation model.
 * Sends progress updates to the renderer via IPC.
 * Returns the engine mode to switch to on completion.
 */
export async function startOnboardingDownload(
  mainWindow: BrowserWindow | null
): Promise<string | null> {
  const target = getOnboardingTarget()
  if (!target) {
    log.warn('No onboarding target configured')
    return null
  }

  // Already downloaded
  if (isGGUFDownloaded(target.filename)) {
    store.set('onboardingModelStatus', 'completed')
    store.set('onboardingDownloadProgress', 100)
    sendProgress(mainWindow, { status: 'completed', progress: 100 })
    return target.engineMode
  }

  // Already downloading
  if (store.get('onboardingModelStatus') === 'downloading') {
    log.info('Onboarding download already in progress')
    return null
  }

  store.set('onboardingModelStatus', 'downloading')
  store.set('onboardingDownloadProgress', 0)
  sendProgress(mainWindow, { status: 'downloading', progress: 0 })

  log.info(`Starting onboarding download: ${target.label} (${target.sizeMB}MB)`)

  try {
    await downloadGGUF(target.filename, target.url, (message) => {
      // Parse progress percentage from download message
      const pctMatch = message.match(/(\d+)%/)
      if (pctMatch) {
        const progress = parseInt(pctMatch[1], 10)
        store.set('onboardingDownloadProgress', progress)
        sendProgress(mainWindow, { status: 'downloading', progress, message })
      }
      // Also forward to general status updates
      mainWindow?.webContents.send('status-update', message)
    }, target.sha256)

    store.set('onboardingModelStatus', 'completed')
    store.set('onboardingDownloadProgress', 100)
    sendProgress(mainWindow, { status: 'completed', progress: 100 })
    log.info(`Onboarding download complete: ${target.label}`)

    return target.engineMode
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    store.set('onboardingModelStatus', 'failed')
    sendProgress(mainWindow, { status: 'failed', progress: 0, error: message })
    log.error(`Onboarding download failed: ${message}`)
    return null
  }
}

/** Send download progress to renderer */
function sendProgress(
  mainWindow: BrowserWindow | null,
  data: { status: string; progress: number; message?: string; error?: string }
): void {
  mainWindow?.webContents.send('onboarding-download-progress', data)
}
