import { selectEngines, type EngineSelection } from './engine-selection'
import { requiredModels, isRequiredModelReady, type RequiredModel } from './required-models'
import { DEFAULT_WHISPER_VARIANT, type WhisperVariant } from './model-downloader'

/** Engine setup shown by Quick Start: the one engine pair this platform runs */
export interface EngineRecommendation {
  sttEngine: EngineSelection['sttEngine']
  translationEngine: 'auto'
  whisperVariant: WhisperVariant
  /** Models that still need downloading before the engines can run */
  downloads: RequiredModel[]
  totalDownloadMB: number
  needsDownload: boolean
  fallbackEngine: null
  reason: string
}

export function recommendEngines(platform: NodeJS.Platform, arch: string): EngineRecommendation {
  const selection = selectEngines(platform, arch)
  const downloads = requiredModels(selection).filter((m) => !isRequiredModelReady(m))
  return {
    sttEngine: selection.sttEngine,
    translationEngine: 'auto',
    whisperVariant: DEFAULT_WHISPER_VARIANT,
    downloads,
    totalDownloadMB: downloads.reduce((sum, d) => sum + d.sizeMB, 0),
    needsDownload: downloads.length > 0,
    fallbackEngine: null,
    reason: selection.sttEngine === 'qwen3-asr'
      ? 'Apple Silicon: Qwen3-ASR 0.6B (MLX) + Hy-MT2-1.8B, all on this Mac'
      : 'Whisper large-v3-turbo (whisper.cpp) + Hy-MT2-1.8B, all on this PC'
  }
}
