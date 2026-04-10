import { ipcMain } from 'electron'
import os from 'os'
import { detectGpu } from '../../engines/gpu-detector'
import { recommendEngines } from '../../engines/hardware-recommender'
import { downloadModel, downloadGGUF } from '../../engines/model-downloader'
import type { WhisperVariant } from '../../engines/model-downloader'
import type { EngineRecommendation } from '../../engines/hardware-recommender'
import { store } from '../store'
import { createLogger } from '../logger'
import type { AppContext } from '../app-context'

const log = createLogger('ipc:quickstart')

/** Register Quick Start onboarding IPC handlers (#510) */
export function registerQuickStartIpc(ctx: AppContext): void {
  // Get hardware recommendation without applying it
  ipcMain.handle('quick-start-recommend', async () => {
    const gpuInfo = await detectGpu()
    const totalMemoryMB = Math.round(os.totalmem() / (1024 * 1024))
    const recommendation = recommendEngines(gpuInfo, process.platform, totalMemoryMB)
    return recommendation
  })

  // Apply recommendation: save settings and start model downloads
  ipcMain.handle('quick-start-apply', async (
    _event,
    options: {
      sourceLanguage: string
      targetLanguage: string
      recommendation: EngineRecommendation
    }
  ) => {
    const { sourceLanguage, targetLanguage, recommendation } = options

    // Apply recommended settings to store
    store.set('sttEngine', recommendation.sttEngine)
    store.set('translationEngine', recommendation.translationEngine)
    store.set('whisperVariant', recommendation.whisperVariant)
    store.set('sourceLanguage', sourceLanguage as never)
    store.set('targetLanguage', targetLanguage as never)
    store.set('hasCompletedSetup', true)

    log.info(`Quick Start applied: STT=${recommendation.sttEngine}, Translator=${recommendation.translationEngine}, Whisper=${recommendation.whisperVariant}`)

    // Start model downloads in background
    if (recommendation.needsDownload) {
      const sendProgress = (msg: string): void => {
        ctx.mainWindow?.webContents.send('status-update', msg)
      }

      // Don't await — let downloads happen in background
      downloadModelsInBackground(recommendation, sendProgress).catch((err) => {
        log.error('Background model download failed:', err)
        ctx.mainWindow?.webContents.send('status-update', `Download failed: ${err instanceof Error ? err.message : String(err)}`)
      })
    }

    return { success: true }
  })

  // Check if setup has been completed
  ipcMain.handle('quick-start-is-completed', () => {
    if (process.env.SKIP_ONBOARDING === '1') return true
    return store.get('hasCompletedSetup')
  })

  // Skip Quick Start (mark as completed without changing settings)
  ipcMain.handle('quick-start-skip', () => {
    store.set('hasCompletedSetup', true)
    return { success: true }
  })

  // Get system memory info for recommendation display
  ipcMain.handle('quick-start-system-info', async () => {
    const gpuInfo = await detectGpu()
    const totalMemoryMB = Math.round(os.totalmem() / (1024 * 1024))
    return {
      platform: process.platform,
      totalMemoryMB,
      gpuInfo
    }
  })
}

/** Download required models in background with progress reporting */
async function downloadModelsInBackground(
  recommendation: EngineRecommendation,
  onProgress: (msg: string) => void
): Promise<void> {
  for (const download of recommendation.downloads) {
    if (download.type === 'whisper') {
      await downloadModel(onProgress, download.key as WhisperVariant)
    } else if (download.type === 'gguf') {
      await downloadGGUF(download.filename, download.url, onProgress)
    }
  }
  onProgress('All models downloaded — ready to translate')
}
