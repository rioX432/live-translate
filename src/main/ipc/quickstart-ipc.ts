import { ipcMain } from 'electron'
import os from 'os'
import { detectGpu } from '../../engines/gpu-detector'
import { recommendEngines } from '../../engines/hardware-recommender'
import { selectEngines } from '../../engines/engine-selection'
import { requiredModels, isRequiredModelReady, downloadRequiredModel, type RequiredModel } from '../../engines/required-models'
import { store } from '../store'
import { createLogger } from '../logger'
import type { AppContext } from '../app-context'

const log = createLogger('ipc:quickstart')

/** Register Quick Start onboarding IPC handlers (#510) */
export function registerQuickStartIpc(ctx: AppContext): void {
  // Get hardware recommendation without applying it
  ipcMain.handle('quick-start-recommend', () => recommendEngines(process.platform, process.arch))

  // The engines are fixed per platform, so the recommendation is recomputed here rather
  // than trusted from the renderer; only the languages come from the user.
  ipcMain.handle('quick-start-apply', async (
    _event,
    options: { sourceLanguage: string; targetLanguage: string }
  ) => {
    const { sourceLanguage, targetLanguage } = options
    const selection = selectEngines(process.platform, process.arch)

    store.set('sttEngine', selection.sttEngine)
    store.set('translationEngine', 'auto')
    store.set('sourceLanguage', sourceLanguage as never)
    store.set('targetLanguage', targetLanguage as never)
    store.set('hasCompletedSetup', true)
    log.info(`Quick Start applied: STT=${selection.sttEngine}, Translator=${selection.translatorEngine}`)

    const missing = requiredModels(selection).filter((m) => !isRequiredModelReady(m))
    if (missing.length > 0) {
      const sendProgress = (msg: string): void => {
        ctx.mainWindow?.webContents.send('status-update', msg)
      }
      // Don't await — let downloads happen in background
      downloadModelsInBackground(missing, sendProgress).catch((err) => {
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
  models: RequiredModel[],
  onProgress: (msg: string) => void
): Promise<void> {
  for (const model of models) {
    await downloadRequiredModel(model, onProgress)
  }
  onProgress('All models downloaded — ready to translate')
}
