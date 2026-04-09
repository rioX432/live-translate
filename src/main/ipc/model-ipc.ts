import { ipcMain } from 'electron'
import { isGGUFDownloaded, getGGUFVariants, getHunyuanMTVariants, getHunyuanMT15Variants, getWhisperVariants, isModelDownloaded as isWhisperModelDownloaded } from '../../engines/model-downloader'
import type { SLMModelSize, WhisperVariant } from '../../engines/model-downloader'
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

  ipcMain.handle('get-hunyuan-mt-variants', () => {
    const variants = getHunyuanMTVariants()
    return Object.entries(variants).map(([key, v]) => ({
      key,
      label: v.label,
      filename: v.filename,
      sizeMB: v.sizeMB,
      downloaded: isGGUFDownloaded(v.filename)
    }))
  })

  ipcMain.handle('get-hunyuan-mt-15-variants', () => {
    const variants = getHunyuanMT15Variants()
    return Object.entries(variants).map(([key, v]) => ({
      key,
      label: v.label,
      filename: v.filename,
      sizeMB: v.sizeMB,
      downloaded: isGGUFDownloaded(v.filename)
    }))
  })

  ipcMain.handle('get-whisper-variants', () => {
    const variants = getWhisperVariants()
    return Object.entries(variants).map(([key, v]) => ({
      key,
      label: v.label,
      description: v.description,
      filename: v.filename,
      sizeMB: v.sizeMB,
      downloaded: isWhisperModelDownloaded(key as WhisperVariant)
    }))
  })

  ipcMain.handle('list-plugins', () => listPlugins())
  ipcMain.handle('detect-gpu', async () => detectGpu())
  ipcMain.handle('get-platform', () => process.platform)

  // macOS version detection for feature gating (e.g., Apple SpeechTranscriber requires macOS 26+)
  ipcMain.handle('get-macos-version', () => {
    if (process.platform !== 'darwin') return null
    // process.getSystemVersion() returns e.g. "26.0.0" for macOS 26 (Tahoe)
    return process.getSystemVersion?.() ?? null
  })
}
