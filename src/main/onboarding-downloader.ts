import { store } from './store'
import { createLogger } from './logger'
import {
  isGGUFDownloaded,
  downloadGGUF,
  isModelDownloaded,
  downloadModel,
  getHunyuanMT15Variants,
  getLFM2Variants,
  WHISPER_VARIANTS
} from '../engines/model-downloader'
import type { WhisperVariant } from '../engines/model-downloader'
import type { BrowserWindow } from 'electron'

const log = createLogger('onboarding-downloader')

// ---------------------------------------------------------------------------
// Model tier system (#694)
// Tier 1: smallest viable STT + translation pair for instant start (~371MB)
// Tier 2: full-quality models downloaded in background after Tier 1 is ready
// ---------------------------------------------------------------------------

/** Model tier identifier */
export type ModelTier = 1 | 2

/** A single model to download as part of a tier */
interface TierModel {
  /** Which tier this model belongs to */
  tier: ModelTier
  /** Unique key for tracking download state */
  key: string
  /** Human-readable label */
  label: string
  /** Approximate size in MB */
  sizeMB: number
  /** 'whisper' uses downloadModel(), 'gguf' uses downloadGGUF() */
  type: 'whisper' | 'gguf'
  /** For whisper models */
  whisperVariant?: WhisperVariant
  /** For gguf models */
  ggufFilename?: string
  ggufUrl?: string
  ggufSha256?: string
  /** Engine mode to use when this model is available */
  sttEngineId?: string
  translatorEngineId?: string
  engineMode?: string
}

/** Tier 1: Whisper base (142MB) + LFM2 Q4_K_M (229MB) = ~371MB total */
function getTier1Models(): TierModel[] {
  const lfm2 = getLFM2Variants()['Q4_K_M']
  const models: TierModel[] = [
    {
      tier: 1,
      key: 'tier1-stt',
      label: 'Whisper Base (Fast STT)',
      sizeMB: WHISPER_VARIANTS['base'].sizeMB,
      type: 'whisper',
      whisperVariant: 'base',
      sttEngineId: 'whisper-local'
    }
  ]
  if (lfm2) {
    models.push({
      tier: 1,
      key: 'tier1-translator',
      label: 'LFM2-350M (Fast Translation)',
      sizeMB: lfm2.sizeMB,
      type: 'gguf',
      ggufFilename: lfm2.filename,
      ggufUrl: lfm2.url,
      translatorEngineId: 'lfm2',
      engineMode: 'offline-lfm2'
    })
  }
  return models
}

/** Tier 2: Full-quality models for upgrade after Tier 1 is usable */
function getTier2Models(): TierModel[] {
  const models: TierModel[] = [
    // Full STT: Kotoba Whisper v2.0 (JA-optimized, 540MB)
    {
      tier: 2,
      key: 'tier2-stt',
      label: 'Whisper Kotoba v2.0 (JA-optimized)',
      sizeMB: WHISPER_VARIANTS['kotoba-v2.0'].sizeMB,
      type: 'whisper',
      whisperVariant: 'kotoba-v2.0',
      sttEngineId: 'whisper-local'
    }
  ]

  // Full translator: HY-MT1.5-1.8B Q4_K_M (~1.1GB)
  // Upgrades from LFM2 (Tier 1) for better translation quality
  const hymt15 = getHunyuanMT15Variants()['Q4_K_M']
  if (hymt15) {
    models.push({
      tier: 2,
      key: 'tier2-translator',
      label: 'HY-MT1.5-1.8B (Quality Translation)',
      sizeMB: hymt15.sizeMB,
      type: 'gguf',
      ggufFilename: hymt15.filename,
      ggufUrl: hymt15.url,
      translatorEngineId: 'hunyuan-mt-15',
      engineMode: 'offline-hymt15'
    })
  }

  return models
}

/** Check if a specific model is already downloaded */
function isModelReady(model: TierModel): boolean {
  if (model.type === 'whisper' && model.whisperVariant) {
    return isModelDownloaded(model.whisperVariant)
  }
  if (model.type === 'gguf' && model.ggufFilename) {
    return isGGUFDownloaded(model.ggufFilename)
  }
  return false
}

/** Check if all Tier 1 models are downloaded and ready */
export function isTier1Ready(): boolean {
  return getTier1Models().every(isModelReady)
}

/** Check if all Tier 2 models are downloaded and ready */
export function isTier2Ready(): boolean {
  return getTier2Models().every(isModelReady)
}

/** Check if the preferred local model is already downloaded (legacy compat) */
export function isOnboardingModelReady(): boolean {
  return isTier1Ready()
}

/** Get the engine configuration for Tier 1 models */
export function getTier1EngineConfig(): { sttEngineId: string; translatorEngineId: string; engineMode: string; whisperVariant: string } | null {
  const models = getTier1Models()
  const stt = models.find(m => m.sttEngineId)
  const translator = models.find(m => m.translatorEngineId)
  if (!stt || !translator) return null
  return {
    sttEngineId: stt.sttEngineId!,
    translatorEngineId: translator.translatorEngineId!,
    engineMode: translator.engineMode!,
    whisperVariant: stt.whisperVariant || 'base'
  }
}

/** Get the engine configuration for Tier 2 models */
export function getTier2EngineConfig(): { sttEngineId: string; translatorEngineId: string; engineMode: string; whisperVariant: string } | null {
  const models = getTier2Models()
  const stt = models.find(m => m.sttEngineId)
  const translator = models.find(m => m.translatorEngineId)
  if (!stt || !translator) return null
  return {
    sttEngineId: stt.sttEngineId!,
    translatorEngineId: translator.translatorEngineId!,
    engineMode: translator.engineMode!,
    whisperVariant: stt.whisperVariant || 'kotoba-v2.0'
  }
}

// ---------------------------------------------------------------------------
// Progressive download status
// ---------------------------------------------------------------------------

export interface ProgressiveDownloadStatus {
  /** Current download phase */
  tier: ModelTier | null
  /** Overall status */
  status: 'idle' | 'downloading-tier1' | 'tier1-ready' | 'downloading-tier2' | 'all-ready' | 'failed'
  /** Progress for current tier (0-100) */
  progress: number
  /** Whether Tier 1 models are downloaded */
  tier1Ready: boolean
  /** Whether Tier 2 models are downloaded */
  tier2Ready: boolean
  /** Current download label */
  currentLabel: string
  /** Total size of current tier */
  currentTierSizeMB: number
  /** Error message if failed */
  error?: string
}

/** Get full progressive download status for renderer */
export function getOnboardingStatus(): ProgressiveDownloadStatus {
  const tier1Ready = isTier1Ready()
  const tier2Ready = isTier2Ready()
  const storedStatus = store.get('onboardingModelStatus')
  const progress = store.get('onboardingDownloadProgress')

  let status: ProgressiveDownloadStatus['status']
  if (tier1Ready && tier2Ready) {
    status = 'all-ready'
  } else if (tier1Ready && storedStatus === 'downloading') {
    status = 'downloading-tier2'
  } else if (tier1Ready) {
    status = 'tier1-ready'
  } else if (storedStatus === 'downloading') {
    status = 'downloading-tier1'
  } else if (storedStatus === 'failed') {
    status = 'failed'
  } else {
    status = 'idle'
  }

  const tier1Models = getTier1Models()
  const tier2Models = getTier2Models()
  const tier1Size = tier1Models.reduce((s, m) => s + m.sizeMB, 0)
  const tier2Size = tier2Models.reduce((s, m) => s + m.sizeMB, 0)

  return {
    tier: tier1Ready ? 2 : 1,
    status,
    progress,
    tier1Ready,
    tier2Ready,
    currentLabel: tier1Ready
      ? tier2Models.map(m => m.label).join(' + ')
      : tier1Models.map(m => m.label).join(' + '),
    currentTierSizeMB: tier1Ready ? tier2Size : tier1Size
  }
}

// ---------------------------------------------------------------------------
// Download orchestration
// ---------------------------------------------------------------------------

/** Download a single model with progress reporting */
async function downloadTierModel(
  model: TierModel,
  mainWindow: BrowserWindow | null,
  onProgress: (pct: number, message: string) => void
): Promise<void> {
  if (isModelReady(model)) {
    log.info(`Model already downloaded: ${model.label}`)
    return
  }

  if (model.type === 'whisper' && model.whisperVariant) {
    await downloadModel((message) => {
      const pctMatch = message.match(/(\d+)%/)
      if (pctMatch) onProgress(parseInt(pctMatch[1], 10), message)
      mainWindow?.webContents.send('status-update', message)
    }, model.whisperVariant)
  } else if (model.type === 'gguf' && model.ggufFilename && model.ggufUrl) {
    await downloadGGUF(model.ggufFilename, model.ggufUrl, (message) => {
      const pctMatch = message.match(/(\d+)%/)
      if (pctMatch) onProgress(parseInt(pctMatch[1], 10), message)
      mainWindow?.webContents.send('status-update', message)
    }, model.ggufSha256)
  }
}

/**
 * Start progressive download: Tier 1 first, then Tier 2 in background.
 * Downloads models within each tier in parallel for maximum speed.
 * Returns the engine mode available after Tier 1 completes.
 */
export async function startOnboardingDownload(
  mainWindow: BrowserWindow | null
): Promise<string | null> {
  // Already downloading
  if (store.get('onboardingModelStatus') === 'downloading') {
    log.info('Onboarding download already in progress')
    return null
  }

  // Phase 1: Tier 1 (instant-start models)
  if (!isTier1Ready()) {
    const tier1Models = getTier1Models()
    const tier1Config = getTier1EngineConfig()
    if (tier1Models.length === 0 || !tier1Config) {
      log.warn('No Tier 1 models configured')
      return null
    }

    store.set('onboardingModelStatus', 'downloading')
    store.set('onboardingDownloadProgress', 0)
    sendProgress(mainWindow, {
      status: 'downloading-tier1',
      progress: 0,
      tier: 1,
      tier1Ready: false,
      tier2Ready: false
    })

    const totalSizeMB = tier1Models.reduce((s, m) => s + m.sizeMB, 0)
    log.info(`Starting Tier 1 download: ${tier1Models.map(m => m.label).join(', ')} (${totalSizeMB}MB)`)

    try {
      // Track per-model progress for combined percentage
      const modelProgress = new Map<string, number>()
      for (const m of tier1Models) modelProgress.set(m.key, 0)

      const updateCombinedProgress = (): void => {
        // Weight progress by model size
        let weightedDone = 0
        for (const m of tier1Models) {
          weightedDone += (modelProgress.get(m.key) || 0) * m.sizeMB
        }
        const pct = Math.round(weightedDone / totalSizeMB)
        store.set('onboardingDownloadProgress', pct)
        sendProgress(mainWindow, {
          status: 'downloading-tier1',
          progress: pct,
          tier: 1,
          tier1Ready: false,
          tier2Ready: false
        })
      }

      // Download Tier 1 models in parallel
      await Promise.all(
        tier1Models.map(model =>
          downloadTierModel(model, mainWindow, (pct) => {
            modelProgress.set(model.key, pct)
            updateCombinedProgress()
          })
        )
      )

      store.set('onboardingDownloadProgress', 100)
      sendProgress(mainWindow, {
        status: 'tier1-ready',
        progress: 100,
        tier: 1,
        tier1Ready: true,
        tier2Ready: isTier2Ready()
      })
      log.info('Tier 1 download complete — basic offline translation ready')

      // Start Tier 2 download in background (non-blocking)
      startTier2Download(mainWindow).catch((err) => {
        log.error('Tier 2 background download failed:', err)
      })

      return tier1Config.engineMode
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      store.set('onboardingModelStatus', 'failed')
      sendProgress(mainWindow, {
        status: 'failed',
        progress: 0,
        tier: 1,
        tier1Ready: false,
        tier2Ready: false,
        error: message
      })
      log.error(`Tier 1 download failed: ${message}`)
      return null
    }
  }

  // Tier 1 already ready — just start Tier 2 if needed
  const tier1Config = getTier1EngineConfig()
  if (!isTier2Ready()) {
    startTier2Download(mainWindow).catch((err) => {
      log.error('Tier 2 background download failed:', err)
    })
  }
  return tier1Config?.engineMode ?? null
}

/**
 * Download Tier 2 (full-quality) models in background.
 * Does not block the main onboarding flow.
 */
async function startTier2Download(mainWindow: BrowserWindow | null): Promise<void> {
  if (isTier2Ready()) {
    sendProgress(mainWindow, {
      status: 'all-ready',
      progress: 100,
      tier: 2,
      tier1Ready: true,
      tier2Ready: true
    })
    return
  }

  const tier2Models = getTier2Models().filter(m => !isModelReady(m))
  if (tier2Models.length === 0) return

  store.set('onboardingModelStatus', 'downloading')
  store.set('onboardingDownloadProgress', 0)
  const totalSizeMB = tier2Models.reduce((s, m) => s + m.sizeMB, 0)

  log.info(`Starting Tier 2 download: ${tier2Models.map(m => m.label).join(', ')} (${totalSizeMB}MB)`)

  sendProgress(mainWindow, {
    status: 'downloading-tier2',
    progress: 0,
    tier: 2,
    tier1Ready: true,
    tier2Ready: false
  })

  try {
    const modelProgress = new Map<string, number>()
    for (const m of tier2Models) modelProgress.set(m.key, 0)

    const updateCombinedProgress = (): void => {
      let weightedDone = 0
      for (const m of tier2Models) {
        weightedDone += (modelProgress.get(m.key) || 0) * m.sizeMB
      }
      const pct = Math.round(weightedDone / totalSizeMB)
      store.set('onboardingDownloadProgress', pct)
      sendProgress(mainWindow, {
        status: 'downloading-tier2',
        progress: pct,
        tier: 2,
        tier1Ready: true,
        tier2Ready: false
      })
    }

    // Download Tier 2 models sequentially to avoid bandwidth contention
    // with any active translation pipeline
    for (const model of tier2Models) {
      await downloadTierModel(model, mainWindow, (pct) => {
        modelProgress.set(model.key, pct)
        updateCombinedProgress()
      })
      modelProgress.set(model.key, 100)
      updateCombinedProgress()
    }

    store.set('onboardingModelStatus', 'completed')
    store.set('onboardingDownloadProgress', 100)
    sendProgress(mainWindow, {
      status: 'all-ready',
      progress: 100,
      tier: 2,
      tier1Ready: true,
      tier2Ready: true
    })
    log.info('Tier 2 download complete — full quality models ready')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // Don't set main status to failed — Tier 1 is still usable
    log.error(`Tier 2 download failed: ${message}`)
    sendProgress(mainWindow, {
      status: 'tier1-ready',
      progress: 0,
      tier: 2,
      tier1Ready: true,
      tier2Ready: false,
      error: `Tier 2 download failed: ${message}`
    })
  }
}

/** Send download progress to renderer */
function sendProgress(
  mainWindow: BrowserWindow | null,
  data: {
    status: string
    progress: number
    tier?: ModelTier | null
    tier1Ready?: boolean
    tier2Ready?: boolean
    message?: string
    error?: string
  }
): void {
  mainWindow?.webContents.send('onboarding-download-progress', data)
}
