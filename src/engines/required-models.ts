import {
  WHISPER_VARIANTS,
  DEFAULT_WHISPER_VARIANT,
  HY_MT2_MODEL,
  QWEN3_ASR_MODEL,
  isModelDownloaded,
  downloadModel,
  isGGUFDownloaded,
  downloadGGUF,
  isPinnedRepoDownloaded,
  downloadPinnedRepo
} from './model-downloader'
import type { EngineSelection } from './engine-selection'

/** A model the selected engines need on disk before they can run */
export interface RequiredModel {
  kind: 'whisper' | 'gguf' | 'pinned-repo'
  /** Stable id for progress tracking */
  key: string
  label: string
  sizeMB: number
}

export function requiredModels(selection: EngineSelection): RequiredModel[] {
  const stt: RequiredModel = selection.sttEngine === 'qwen3-asr'
    ? { kind: 'pinned-repo', key: QWEN3_ASR_MODEL.dirName, label: QWEN3_ASR_MODEL.label, sizeMB: QWEN3_ASR_MODEL.sizeMB }
    : {
        kind: 'whisper',
        key: DEFAULT_WHISPER_VARIANT,
        label: `Whisper ${WHISPER_VARIANTS[DEFAULT_WHISPER_VARIANT].label}`,
        sizeMB: WHISPER_VARIANTS[DEFAULT_WHISPER_VARIANT].sizeMB
      }
  const translator: RequiredModel = {
    kind: 'gguf',
    key: HY_MT2_MODEL.filename,
    label: HY_MT2_MODEL.label,
    sizeMB: HY_MT2_MODEL.sizeMB
  }
  return [stt, translator]
}

export function isRequiredModelReady(model: RequiredModel): boolean {
  switch (model.kind) {
    case 'whisper': return isModelDownloaded(DEFAULT_WHISPER_VARIANT)
    case 'gguf': return isGGUFDownloaded(HY_MT2_MODEL.filename)
    case 'pinned-repo': return isPinnedRepoDownloaded(QWEN3_ASR_MODEL)
  }
}

export async function downloadRequiredModel(
  model: RequiredModel,
  onProgress?: (message: string) => void
): Promise<void> {
  switch (model.kind) {
    case 'whisper':
      await downloadModel(onProgress, DEFAULT_WHISPER_VARIANT)
      return
    case 'gguf':
      await downloadGGUF(HY_MT2_MODEL.filename, HY_MT2_MODEL.url, onProgress, HY_MT2_MODEL.sha256)
      return
    case 'pinned-repo':
      await downloadPinnedRepo(QWEN3_ASR_MODEL, onProgress)
      return
  }
}
