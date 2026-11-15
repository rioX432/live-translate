import { app, ipcMain } from 'electron'
import { isGGUFDownloaded, getGGUFVariants } from '../../engines/model-downloader'
import type { SLMModelSize } from '../../engines/model-downloader'
import { detectGpu } from '../../engines/gpu-detector'
import { listPlugins } from '../../engines/plugin-loader'
import { store } from '../store'

/** Register model status and misc IPC handlers */
export function registerModelIpc(): void {
  ipcMain.handle('get-gguf-variants', (_event, modelSize?: SLMModelSize) => {
    const variants = getGGUFVariants(modelSize ?? store.get('slmModelSize'))
    return Object.entries(variants).map(([key, v]) => ({
      key,
      label: v.label,
      filename: v.filename,
      sizeMB: v.sizeMB,
      downloaded: isGGUFDownloaded(v.filename)
    }))
  })

  ipcMain.handle('is-draft-model-available', (_event, _engine?: string) => {
    // TranslateGemma 12B uses 4B as draft model
    const draftVariants = getGGUFVariants('4b')
    const draftVariantConfig = draftVariants['Q4_K_M']
    return draftVariantConfig ? isGGUFDownloaded(draftVariantConfig.filename) : false
  })

  // Packaged builds never load plugins, so there is nothing to list
  ipcMain.handle('list-plugins', () => (app.isPackaged ? [] : listPlugins()))
  ipcMain.handle('detect-gpu', async () => detectGpu())
  ipcMain.handle('get-platform', () => process.platform)
}
