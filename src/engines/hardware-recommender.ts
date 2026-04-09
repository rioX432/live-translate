import type { GpuInfo } from './gpu-detector'
import {
  WHISPER_VARIANTS,
  HUNYUAN_MT_15_VARIANTS,
  LFM2_VARIANTS,
  isModelDownloaded,
  isGGUFDownloaded
} from './model-downloader'
import type { WhisperVariant } from './model-downloader'

/** Engine recommendation produced by hardware analysis */
export interface EngineRecommendation {
  sttEngine: 'whisper-local' | 'mlx-whisper' | 'kotoba-whisper' | 'apple-speech-transcriber'
  translationEngine: string
  whisperVariant: WhisperVariant
  /** Models that need downloading before offline engines can run */
  downloads: DownloadItem[]
  /** Total download size in MB */
  totalDownloadMB: number
  /** Whether the user needs to download models before starting */
  needsDownload: boolean
  /** Fallback translation engine to use while models download (API-based or lighter) */
  fallbackEngine: string | null
  /** Human-readable reason for the recommendation */
  reason: string
}

export interface DownloadItem {
  type: 'whisper' | 'gguf'
  /** For whisper: the variant key (e.g. 'kotoba-v2.0'). For gguf: the filename. */
  key: string
  filename: string
  url: string
  sizeMB: number
  label: string
}

/** Detect if running on Apple Silicon (M1+) */
function isAppleSilicon(platform: string, gpuInfo: GpuInfo): boolean {
  if (platform !== 'darwin') return false
  return gpuInfo.gpuNames.some((name) =>
    /apple/i.test(name) || /m[1-4]/i.test(name)
  )
}

/** Detect if running on Windows with NVIDIA CUDA-capable GPU */
function hasNvidiaCuda(platform: string, gpuInfo: GpuInfo): boolean {
  if (platform !== 'win32') return false
  return gpuInfo.gpuNames.some((name) => /nvidia|geforce|rtx|gtx/i.test(name))
}

/** Detect if macOS 26+ (Tahoe) is running for Apple SpeechTranscriber support */
function isMacOS26Plus(): boolean {
  if (process.platform !== 'darwin') return false
  try {
    // process.getSystemVersion() returns e.g. "26.0.0" for macOS 26
    const version = process.getSystemVersion?.()
    if (!version) return false
    const major = parseInt(version.split('.')[0], 10)
    return major >= 26
  } catch {
    return false
  }
}

/**
 * Recommend optimal engines based on hardware capabilities.
 *
 * Priority:
 * 0. macOS 26+ (any Apple Silicon): Apple SpeechTranscriber — zero setup, ANE-native (#548)
 * 1. Apple Silicon M1+ with >=16GB: MLX Whisper (or Kotoba-Whisper for JA) + HY-MT1.5-1.8B
 * 2. Apple Silicon M1+ with >=8GB: MLX Whisper (or Kotoba-Whisper for JA) + LFM2 (lighter)
 * 3. Apple Silicon M1+ with <8GB: MLX Whisper (or Kotoba-Whisper for JA) + API fallback
 * 4. Intel Mac / other: Whisper Local (base) + API fallback
 *
 * When sourceLanguage is 'ja', Kotoba-Whisper v2.0 is preferred on Apple Silicon
 * (JA CER 5.6% vs MLX Whisper's 8.1%).
 */
export function recommendEngines(
  gpuInfo: GpuInfo,
  platform: string,
  totalMemoryMB: number,
  sourceLanguage?: string
): EngineRecommendation {
  const appleSilicon = isAppleSilicon(platform, gpuInfo)
  const macOS26 = isMacOS26Plus()
  const downloads: DownloadItem[] = []
  // Prefer Kotoba-Whisper for JA-only setups on Apple Silicon (unless macOS 26+ available)
  const preferKotoba = appleSilicon && sourceLanguage === 'ja' && !macOS26

  // macOS 26+ with Apple Silicon: prefer Apple SpeechTranscriber (zero setup, ANE-optimized)
  if (macOS26 && appleSilicon) {
    const sttEngine = 'apple-speech-transcriber' as const
    // Choose translator based on memory (same logic as other Apple Silicon tiers)
    if (totalMemoryMB >= 16384) {
      const whisperVariant: WhisperVariant = 'kotoba-v2.0'
      const gguf = HUNYUAN_MT_15_VARIANTS['Q4_K_M']
      if (!isGGUFDownloaded(gguf.filename)) {
        downloads.push({ type: 'gguf', key: gguf.filename, filename: gguf.filename, url: gguf.url, sizeMB: gguf.sizeMB, label: gguf.label })
      }
      return {
        sttEngine,
        translationEngine: 'offline-hymt15',
        whisperVariant,
        downloads,
        totalDownloadMB: downloads.reduce((sum, d) => sum + d.sizeMB, 0),
        needsDownload: downloads.length > 0,
        fallbackEngine: downloads.length > 0 ? 'offline-opus' : null,
        reason: 'macOS 26+ — using Apple SpeechTranscriber (zero setup, ANE) + HY-MT 1.5 for best offline quality'
      }
    }
    if (totalMemoryMB >= 8192) {
      const whisperVariant: WhisperVariant = 'kotoba-v2.0'
      const gguf = LFM2_VARIANTS['Q4_K_M']
      if (!isGGUFDownloaded(gguf.filename)) {
        downloads.push({ type: 'gguf', key: gguf.filename, filename: gguf.filename, url: gguf.url, sizeMB: gguf.sizeMB, label: gguf.label })
      }
      return {
        sttEngine,
        translationEngine: 'offline-lfm2',
        whisperVariant,
        downloads,
        totalDownloadMB: downloads.reduce((sum, d) => sum + d.sizeMB, 0),
        needsDownload: downloads.length > 0,
        fallbackEngine: downloads.length > 0 ? 'offline-opus' : null,
        reason: 'macOS 26+ — using Apple SpeechTranscriber (zero setup, ANE) + LFM2 for lightweight offline translation'
      }
    }
    // Low memory macOS 26+
    return {
      sttEngine,
      translationEngine: 'offline-opus',
      whisperVariant: 'base',
      downloads: [],
      totalDownloadMB: 0,
      needsDownload: false,
      fallbackEngine: null,
      reason: 'macOS 26+ — using Apple SpeechTranscriber (zero setup, ANE) + OPUS-MT for lightweight operation'
    }
  }

  if (appleSilicon && totalMemoryMB >= 16384) {
    // Best experience: MLX Whisper (or Kotoba-Whisper for JA) + HY-MT1.5
    const sttEngine = preferKotoba ? 'kotoba-whisper' as const : 'mlx-whisper' as const
    const translationEngine = 'offline-hymt15'
    const whisperVariant: WhisperVariant = 'kotoba-v2.0'

    // Check which models need downloading
    if (!isModelDownloaded(whisperVariant)) {
      const v = WHISPER_VARIANTS[whisperVariant]
      downloads.push({ type: 'whisper', key: whisperVariant, filename: v.filename, url: v.url, sizeMB: v.sizeMB, label: v.label })
    }
    const gguf = HUNYUAN_MT_15_VARIANTS['Q4_K_M']
    if (!isGGUFDownloaded(gguf.filename)) {
      downloads.push({ type: 'gguf', key: gguf.filename, filename: gguf.filename, url: gguf.url, sizeMB: gguf.sizeMB, label: gguf.label })
    }

    return {
      sttEngine,
      translationEngine,
      whisperVariant,
      downloads,
      totalDownloadMB: downloads.reduce((sum, d) => sum + d.sizeMB, 0),
      needsDownload: downloads.length > 0,
      fallbackEngine: downloads.length > 0 ? 'offline-opus' : null,
      reason: 'Apple Silicon with 16GB+ RAM — using MLX Whisper + HY-MT 1.5 for best offline quality'
    }
  }

  if (appleSilicon && totalMemoryMB >= 8192) {
    // Good experience: MLX Whisper (or Kotoba-Whisper for JA) + LFM2 (ultra-light)
    const sttEngine = preferKotoba ? 'kotoba-whisper' as const : 'mlx-whisper' as const
    const translationEngine = 'offline-lfm2'
    const whisperVariant: WhisperVariant = 'kotoba-v2.0'

    if (!isModelDownloaded(whisperVariant)) {
      const v = WHISPER_VARIANTS[whisperVariant]
      downloads.push({ type: 'whisper', key: whisperVariant, filename: v.filename, url: v.url, sizeMB: v.sizeMB, label: v.label })
    }
    const gguf = LFM2_VARIANTS['Q4_K_M']
    if (!isGGUFDownloaded(gguf.filename)) {
      downloads.push({ type: 'gguf', key: gguf.filename, filename: gguf.filename, url: gguf.url, sizeMB: gguf.sizeMB, label: gguf.label })
    }

    return {
      sttEngine,
      translationEngine,
      whisperVariant,
      downloads,
      totalDownloadMB: downloads.reduce((sum, d) => sum + d.sizeMB, 0),
      needsDownload: downloads.length > 0,
      fallbackEngine: downloads.length > 0 ? 'offline-opus' : null,
      reason: 'Apple Silicon with 8GB RAM — using MLX Whisper + LFM2 for lightweight offline translation'
    }
  }

  if (appleSilicon) {
    // Low memory Apple Silicon: MLX Whisper (or Kotoba-Whisper for JA) + OPUS-MT (no GGUF download needed)
    const sttEngine = preferKotoba ? 'kotoba-whisper' as const : 'mlx-whisper' as const
    const translationEngine = 'offline-opus'
    const whisperVariant: WhisperVariant = 'base'

    if (!isModelDownloaded(whisperVariant)) {
      const v = WHISPER_VARIANTS[whisperVariant]
      downloads.push({ type: 'whisper', key: whisperVariant, filename: v.filename, url: v.url, sizeMB: v.sizeMB, label: v.label })
    }

    return {
      sttEngine,
      translationEngine,
      whisperVariant,
      downloads,
      totalDownloadMB: downloads.reduce((sum, d) => sum + d.sizeMB, 0),
      needsDownload: downloads.length > 0,
      fallbackEngine: null,
      reason: 'Apple Silicon with limited RAM — using MLX Whisper (base) + OPUS-MT for lightweight operation'
    }
  }

  // Windows with NVIDIA GPU: CUDA-accelerated Whisper + GGUF translation
  const nvidiaCuda = hasNvidiaCuda(platform, gpuInfo)

  if (nvidiaCuda && totalMemoryMB >= 16384) {
    // Windows + NVIDIA + 16GB+: Whisper Local (CUDA) + HY-MT1.5
    const whisperVariant: WhisperVariant = 'base'
    if (!isModelDownloaded(whisperVariant)) {
      const v = WHISPER_VARIANTS[whisperVariant]
      downloads.push({ type: 'whisper', key: whisperVariant, filename: v.filename, url: v.url, sizeMB: v.sizeMB, label: v.label })
    }
    const gguf = HUNYUAN_MT_15_VARIANTS['Q4_K_M']
    if (!isGGUFDownloaded(gguf.filename)) {
      downloads.push({ type: 'gguf', key: gguf.filename, filename: gguf.filename, url: gguf.url, sizeMB: gguf.sizeMB, label: gguf.label })
    }

    return {
      sttEngine: 'whisper-local' as const,
      translationEngine: 'offline-hymt15',
      whisperVariant,
      downloads,
      totalDownloadMB: downloads.reduce((sum, d) => sum + d.sizeMB, 0),
      needsDownload: downloads.length > 0,
      fallbackEngine: downloads.length > 0 ? 'offline-opus' : null,
      reason: 'Windows with NVIDIA GPU + 16GB+ RAM — using CUDA Whisper + HY-MT 1.5 for best offline quality'
    }
  }

  if (nvidiaCuda && totalMemoryMB >= 8192) {
    // Windows + NVIDIA + 8GB+: Whisper Local (CUDA) + LFM2
    const whisperVariant: WhisperVariant = 'base'
    if (!isModelDownloaded(whisperVariant)) {
      const v = WHISPER_VARIANTS[whisperVariant]
      downloads.push({ type: 'whisper', key: whisperVariant, filename: v.filename, url: v.url, sizeMB: v.sizeMB, label: v.label })
    }
    const gguf = LFM2_VARIANTS['Q4_K_M']
    if (!isGGUFDownloaded(gguf.filename)) {
      downloads.push({ type: 'gguf', key: gguf.filename, filename: gguf.filename, url: gguf.url, sizeMB: gguf.sizeMB, label: gguf.label })
    }

    return {
      sttEngine: 'whisper-local' as const,
      translationEngine: 'offline-lfm2',
      whisperVariant,
      downloads,
      totalDownloadMB: downloads.reduce((sum, d) => sum + d.sizeMB, 0),
      needsDownload: downloads.length > 0,
      fallbackEngine: downloads.length > 0 ? 'offline-opus' : null,
      reason: 'Windows with NVIDIA GPU + 8GB RAM — using CUDA Whisper + LFM2 for lightweight offline translation'
    }
  }

  // Non-Apple Silicon, no NVIDIA CUDA (Intel Mac, Windows without GPU, or Linux)
  const sttEngine = 'whisper-local' as const
  const whisperVariant: WhisperVariant = 'base'

  if (!isModelDownloaded(whisperVariant)) {
    const v = WHISPER_VARIANTS[whisperVariant]
    downloads.push({ type: 'whisper', key: whisperVariant, filename: v.filename, url: v.url, sizeMB: v.sizeMB, label: v.label })
  }

  return {
    sttEngine,
    translationEngine: 'offline-opus',
    whisperVariant,
    downloads,
    totalDownloadMB: downloads.reduce((sum, d) => sum + d.sizeMB, 0),
    needsDownload: downloads.length > 0,
    fallbackEngine: null,
    reason: 'Using Whisper Local (base) + OPUS-MT for broad compatibility'
  }
}
