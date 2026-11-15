import { store } from './store'
import { createLogger } from './logger'
import { selectEngines } from '../engines/engine-selection'
import { requiredModels, isRequiredModelReady, downloadRequiredModel } from '../engines/required-models'
import type { BrowserWindow } from 'electron'

const log = createLogger('onboarding-downloader')

// The app runs one engine pair per platform, so there is a single model set. The two-tier
// API (#694) is kept for the renderer: Tier 2 is ready exactly when Tier 1 is.

export type ModelTier = 1 | 2

interface EngineConfig {
  sttEngineId: string
  translatorEngineId: string
  engineMode: string
}

function currentModels() {
  return requiredModels(selectEngines(process.platform, process.arch))
}

function areModelsReady(): boolean {
  return currentModels().every(isRequiredModelReady)
}

export function isTier1Ready(): boolean {
  return areModelsReady()
}

export function isTier2Ready(): boolean {
  return areModelsReady()
}

export function isOnboardingModelReady(): boolean {
  return areModelsReady()
}

function engineConfig(): EngineConfig {
  const selection = selectEngines(process.platform, process.arch)
  return {
    sttEngineId: selection.sttEngine,
    translatorEngineId: selection.translatorEngine,
    engineMode: 'auto'
  }
}

export function getTier1EngineConfig(): EngineConfig | null {
  return engineConfig()
}

export function getTier2EngineConfig(): EngineConfig | null {
  return engineConfig()
}

export interface ProgressiveDownloadStatus {
  tier: ModelTier | null
  status: 'idle' | 'downloading-tier1' | 'tier1-ready' | 'downloading-tier2' | 'all-ready' | 'failed'
  /** Progress of the running download (0-100) */
  progress: number
  tier1Ready: boolean
  tier2Ready: boolean
  currentLabel: string
  currentTierSizeMB: number
  error?: string
}

export function getOnboardingStatus(): ProgressiveDownloadStatus {
  const ready = areModelsReady()
  const storedStatus = store.get('onboardingModelStatus')
  const models = currentModels()

  let status: ProgressiveDownloadStatus['status']
  if (ready) status = 'all-ready'
  else if (storedStatus === 'downloading') status = 'downloading-tier1'
  else if (storedStatus === 'failed') status = 'failed'
  else status = 'idle'

  return {
    tier: 1,
    status,
    progress: store.get('onboardingDownloadProgress'),
    tier1Ready: ready,
    tier2Ready: ready,
    currentLabel: models.map((m) => m.label).join(' + '),
    currentTierSizeMB: models.reduce((s, m) => s + m.sizeMB, 0)
  }
}

/**
 * Download the models of the selected engines, in parallel, and report combined progress.
 * Returns the engine mode to use once they are ready, or null if a download failed or one
 * is already running.
 */
export async function startOnboardingDownload(mainWindow: BrowserWindow | null): Promise<string | null> {
  if (store.get('onboardingModelStatus') === 'downloading') {
    log.info('Onboarding download already in progress')
    return null
  }
  const config = engineConfig()
  if (areModelsReady()) {
    sendProgress(mainWindow, { status: 'all-ready', progress: 100, tier: 2, tier1Ready: true, tier2Ready: true })
    return config.engineMode
  }

  const models = currentModels().filter((m) => !isRequiredModelReady(m))
  const totalSizeMB = models.reduce((s, m) => s + m.sizeMB, 0)
  store.set('onboardingModelStatus', 'downloading')
  store.set('onboardingDownloadProgress', 0)
  sendProgress(mainWindow, { status: 'downloading-tier1', progress: 0, tier: 1, tier1Ready: false, tier2Ready: false })
  log.info(`Starting model download: ${models.map((m) => m.label).join(', ')} (${totalSizeMB}MB)`)

  const modelProgress = new Map<string, number>(models.map((m) => [m.key, 0]))
  const updateCombinedProgress = (): void => {
    let weightedDone = 0
    for (const m of models) weightedDone += (modelProgress.get(m.key) ?? 0) * m.sizeMB
    const pct = Math.round(weightedDone / totalSizeMB)
    store.set('onboardingDownloadProgress', pct)
    sendProgress(mainWindow, { status: 'downloading-tier1', progress: pct, tier: 1, tier1Ready: false, tier2Ready: false })
  }

  try {
    await Promise.all(models.map((model) =>
      downloadRequiredModel(model, (message) => {
        const pctMatch = message.match(/(\d+)%/)
        if (pctMatch) {
          modelProgress.set(model.key, parseInt(pctMatch[1], 10))
          updateCombinedProgress()
        }
        mainWindow?.webContents.send('status-update', message)
      })
    ))
    store.set('onboardingModelStatus', 'completed')
    store.set('onboardingDownloadProgress', 100)
    sendProgress(mainWindow, { status: 'all-ready', progress: 100, tier: 2, tier1Ready: true, tier2Ready: true })
    log.info('Model download complete')
    return config.engineMode
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    store.set('onboardingModelStatus', 'failed')
    sendProgress(mainWindow, { status: 'failed', progress: 0, tier: 1, tier1Ready: false, tier2Ready: false, error: message })
    log.error(`Model download failed: ${message}`)
    return null
  }
}

function sendProgress(
  mainWindow: BrowserWindow | null,
  data: {
    status: string
    progress: number
    tier?: ModelTier | null
    tier1Ready?: boolean
    tier2Ready?: boolean
    error?: string
  }
): void {
  mainWindow?.webContents.send('onboarding-download-progress', data)
}
