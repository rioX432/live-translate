import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, unlinkSync, statSync, createWriteStream } from 'fs'
import { createHash } from 'crypto'
import { createLogger } from '../main/logger'

const log = createLogger('model-downloader')

export const MODEL_FILENAME = 'ggml-kotoba-whisper-v2.0-q5_0.bin'
export const MODEL_URL =
  'https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-ggml/resolve/e3a0cf6a62b95911703cfb97d819292e058f12c3/ggml-kotoba-whisper-v2.0-q5_0.bin'
export const MODEL_SHA256 =
  '4a3b92192b5d3578ff854a5876213e2e27af0c2d357492c2d14271e82c303658'

/** Whisper model variant identifier */
export type WhisperVariant = 'kotoba-v2.0' | 'large-v3-turbo' | 'distil-large-v3' | 'base' | 'small'

/** Whisper model variant configuration */
export interface WhisperVariantConfig {
  filename: string
  url: string
  sha256: string
  sizeMB: number
  label: string
  description: string
}

/** Available Whisper model variants for local STT */
export const WHISPER_VARIANTS: Record<WhisperVariant, WhisperVariantConfig> = {
  'kotoba-v2.0': {
    filename: 'ggml-kotoba-whisper-v2.0-q5_0.bin',
    url: 'https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-ggml/resolve/e3a0cf6a62b95911703cfb97d819292e058f12c3/ggml-kotoba-whisper-v2.0-q5_0.bin',
    sha256: '4a3b92192b5d3578ff854a5876213e2e27af0c2d357492c2d14271e82c303658',
    sizeMB: 540,
    label: 'Kotoba Whisper v2.0 (Default)',
    description: 'Optimized for Japanese, ~540MB'
  },
  'large-v3-turbo': {
    filename: 'ggml-large-v3-turbo-q5_0.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin',
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    sizeMB: 600,
    label: 'Large v3 Turbo (OpenAI)',
    description: 'Multilingual, 6x faster than large-v3, ~600MB'
  },
  'distil-large-v3': {
    filename: 'ggml-distil-large-v3.bin',
    url: 'https://huggingface.co/distil-whisper/distil-large-v3-ggml/resolve/0d78dd96ed9fc152325f63b53788fec3b43de031/ggml-distil-large-v3.bin',
    sha256: '2883a11b90fb10ed592d826edeaee7d2929bf1ab985109fe9e1e7b4d2b69a298',
    sizeMB: 1500,
    label: 'Distil Large v3 (HuggingFace)',
    description: 'Distilled large-v3, 5x faster, within 1% WER, ~1.5GB'
  },
  'small': {
    filename: 'ggml-small.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin',
    sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b',
    sizeMB: 466,
    label: 'Small (Fast)',
    description: 'Fast multilingual, lower accuracy, ~466MB'
  },
  'base': {
    filename: 'ggml-base.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-base.bin',
    sha256: '60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe',
    sizeMB: 142,
    label: 'Base (Fastest)',
    description: 'Fastest, lowest accuracy, ~142MB'
  }
}

/** Get available Whisper variants */
export function getWhisperVariants(): Record<WhisperVariant, WhisperVariantConfig> {
  return WHISPER_VARIANTS
}

// Global download lock — serializes all model downloads to prevent disk corruption (#208)
const activeDownloads = new Map<string, Promise<string>>()

export function getModelPath(variant?: WhisperVariant): string {
  const config = variant ? WHISPER_VARIANTS[variant] : null
  const filename = config ? config.filename : MODEL_FILENAME
  return join(getModelsDir(), filename)
}

export function getModelsDir(): string {
  const dir = join(app.getPath('userData'), 'models')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function isModelDownloaded(variant?: WhisperVariant): boolean {
  return existsSync(getModelPath(variant))
}

/** GGUF model variant configuration */
export interface GGUFVariant {
  filename: string
  url: string
  sha256: string
  sizeMB: number
  label: string
}

/** Model size identifier for TranslateGemma */
export type SLMModelSize = '4b' | '12b'

/** Hunyuan-MT-7B GGUF variants (Mungert quantizations) */
export const HUNYUAN_MT_VARIANTS: Record<string, GGUFVariant> = {
  'Q4_K_M': {
    filename: 'Hunyuan-MT-7B-q4_k_m.gguf',
    url: 'https://huggingface.co/Mungert/Hunyuan-MT-7B-GGUF/resolve/61e98ae605cc4fe9581fd3ff1052a271843e4d64/Hunyuan-MT-7B-q4_k_m.gguf',
    sha256: 'c6cb1068db17f851a4dd9e1d2e3217a293a50000e617486e7fd0bfaa05674d88',
    sizeMB: 4700,
    label: 'Q4_K_M (Recommended, ~4.7GB)'
  },
  'Q8_0': {
    filename: 'Hunyuan-MT-7B-q8_0.gguf',
    url: 'https://huggingface.co/Mungert/Hunyuan-MT-7B-GGUF/resolve/61e98ae605cc4fe9581fd3ff1052a271843e4d64/Hunyuan-MT-7B-q8_0.gguf',
    sha256: 'a956c22ff7fadbf4bcf6baca7c81fdfa549ecff1ea6f4995a2355d97c95a9ab5',
    sizeMB: 7980,
    label: 'Q8_0 (Best quality, ~8.0GB)'
  },
  'Q3_K_M': {
    filename: 'Hunyuan-MT-7B-q3_k_m.gguf',
    url: 'https://huggingface.co/Mungert/Hunyuan-MT-7B-GGUF/resolve/61e98ae605cc4fe9581fd3ff1052a271843e4d64/Hunyuan-MT-7B-q3_k_m.gguf',
    sha256: '68018c22f27af64cffb1b70d4f92bbc9063e5d63375df79aa52c5f74acabdff9',
    sizeMB: 3760,
    label: 'Q3_K_M (Smallest, ~3.8GB)'
  }
}

/** Get Hunyuan-MT GGUF variants */
export function getHunyuanMTVariants(): Record<string, GGUFVariant> {
  return HUNYUAN_MT_VARIANTS
}

/** HY-MT1.5-1.8B GGUF variants (official Tencent quantizations) */
export const HUNYUAN_MT_15_VARIANTS: Record<string, GGUFVariant> = {
  'Q4_K_M': {
    filename: 'HY-MT1.5-1.8B-Q4_K_M.gguf',
    url: 'https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/resolve/265b2e615a7dc9b06c435dc878829ad99a512ba2/HY-MT1.5-1.8B-Q4_K_M.gguf',
    sha256: '4383ac0c3c8e476de98ff979c2a3f069f8c4fb385e7860cf2d28da896cc477c7',
    sizeMB: 1130,
    label: 'Q4_K_M (Recommended, ~1.1GB)'
  },
  'Q6_K': {
    filename: 'HY-MT1.5-1.8B-Q6_K.gguf',
    url: 'https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/resolve/265b2e615a7dc9b06c435dc878829ad99a512ba2/HY-MT1.5-1.8B-Q6_K.gguf',
    sha256: 'c3819200ab9a79cb29b9a05ce8920e2eb01ae7ce520094fc5b57356494f3c641',
    sizeMB: 1470,
    label: 'Q6_K (Balanced, ~1.5GB)'
  },
  'Q8_0': {
    filename: 'HY-MT1.5-1.8B-Q8_0.gguf',
    url: 'https://huggingface.co/tencent/HY-MT1.5-1.8B-GGUF/resolve/265b2e615a7dc9b06c435dc878829ad99a512ba2/HY-MT1.5-1.8B-Q8_0.gguf',
    sha256: '6789b06d0902f2f5312c0e1703d56ccbddfcfb6c653d22519b7c720f7db9a98e',
    sizeMB: 1910,
    label: 'Q8_0 (Best quality, ~1.9GB)'
  }
}

/** Get HY-MT1.5-1.8B GGUF variants */
export function getHunyuanMT15Variants(): Record<string, GGUFVariant> {
  return HUNYUAN_MT_15_VARIANTS
}

/** LFM2-350M-ENJP-MT GGUF variants (official Liquid AI quantizations) */
export const LFM2_VARIANTS: Record<string, GGUFVariant> = {
  'Q4_K_M': {
    filename: 'LFM2-350M-ENJP-MT-Q4_K_M.gguf',
    url: 'https://huggingface.co/LiquidAI/LFM2-350M-ENJP-MT-GGUF/resolve/889c88c3d3681b4f342ae210a1d2a1369aba0e10/LFM2-350M-ENJP-MT-Q4_K_M.gguf',
    sha256: '574ef7980dd20d69b494bce82565db5f25124d404be02052bbca62277d33077b',
    sizeMB: 229,
    label: 'Q4_K_M (Recommended, ~229MB)'
  },
  'Q6_K': {
    filename: 'LFM2-350M-ENJP-MT-Q6_K.gguf',
    url: 'https://huggingface.co/LiquidAI/LFM2-350M-ENJP-MT-GGUF/resolve/889c88c3d3681b4f342ae210a1d2a1369aba0e10/LFM2-350M-ENJP-MT-Q6_K.gguf',
    sha256: '309a7dea7e7a543d5fe4d5144e8abcb2ab6b0464655b64eb6339034f7f93280b',
    sizeMB: 293,
    label: 'Q6_K (Balanced, ~293MB)'
  },
  'Q8_0': {
    filename: 'LFM2-350M-ENJP-MT-Q8_0.gguf',
    url: 'https://huggingface.co/LiquidAI/LFM2-350M-ENJP-MT-GGUF/resolve/889c88c3d3681b4f342ae210a1d2a1369aba0e10/LFM2-350M-ENJP-MT-Q8_0.gguf',
    sha256: '261dbe17e21116329b7d131865f4300e3ddfef584999c8bd90ec7e3d199cba7a',
    sizeMB: 379,
    label: 'Q8_0 (Best quality, ~379MB)'
  }
}

/** Get LFM2-350M-ENJP-MT GGUF variants */
export function getLFM2Variants(): Record<string, GGUFVariant> {
  return LFM2_VARIANTS
}

/** PLaMo-2-Translate 10B GGUF variants (mmnga quantizations) */
export const PLAMO_VARIANTS: Record<string, GGUFVariant> = {
  'Q4_K_S': {
    filename: 'plamo-2-translate-Q4_K_S.gguf',
    url: 'https://huggingface.co/mmnga/plamo-2-translate-gguf/resolve/adf2a564beea0e40b411c1c2deffedb7d5b086cf/plamo-2-translate-Q4_K_S.gguf',
    sha256: 'a495f8ef1cbd24fcfd2d6564e02bee783849677cf4080156a078ebfe447c38a7',
    sizeMB: 5510,
    label: 'Q4_K_S (Recommended, ~5.5GB)'
  },
  'Q3_K_M': {
    filename: 'plamo-2-translate-Q3_K_M.gguf',
    url: 'https://huggingface.co/mmnga/plamo-2-translate-gguf/resolve/adf2a564beea0e40b411c1c2deffedb7d5b086cf/plamo-2-translate-Q3_K_M.gguf',
    sha256: 'bb4f44bfb09ee455095776f35eec32de796537fe7bda855a605fe841f5704544',
    sizeMB: 4640,
    label: 'Q3_K_M (Smallest, ~4.6GB)'
  },
  'Q6_K': {
    filename: 'plamo-2-translate-Q6_K.gguf',
    url: 'https://huggingface.co/mmnga/plamo-2-translate-gguf/resolve/adf2a564beea0e40b411c1c2deffedb7d5b086cf/plamo-2-translate-Q6_K.gguf',
    sha256: '4cfe1a86b45ccb34f2c31a98fb5430ed26f43b0316626b2761af83308edf53fa',
    sizeMB: 7820,
    label: 'Q6_K (Balanced, ~7.8GB)'
  },
  'Q8_0': {
    filename: 'plamo-2-translate-Q8_0.gguf',
    url: 'https://huggingface.co/mmnga/plamo-2-translate-gguf/resolve/adf2a564beea0e40b411c1c2deffedb7d5b086cf/plamo-2-translate-Q8_0.gguf',
    sha256: '3fac34aadc7a3ac6e9afd193f0b9bdd12b9f15bd1e5f0d8428f1077263a9de32',
    sizeMB: 10100,
    label: 'Q8_0 (Best quality, ~10.1GB)'
  }
}

/** Get PLaMo-2-Translate GGUF variants */
export function getPLaMoVariants(): Record<string, GGUFVariant> {
  return PLAMO_VARIANTS
}

export const GGUF_VARIANTS_4B: Record<string, GGUFVariant> = {
  'Q4_K_M': {
    filename: 'translategemma-4b-it.Q4_K_M.gguf',
    url: 'https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/d37868f759d2f817a43d28dd80cf9f982ffa62fd/translategemma-4b-it.Q4_K_M.gguf',
    sha256: '81200d03e843d2ec1ece6eeafe7d13cb6e5211e1fcd336ade55790b683a08330',
    sizeMB: 2600,
    label: 'Q4_K_M (Recommended, ~2.6GB)'
  },
  'Q8_0': {
    filename: 'translategemma-4b-it.Q8_0.gguf',
    url: 'https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/d37868f759d2f817a43d28dd80cf9f982ffa62fd/translategemma-4b-it.Q8_0.gguf',
    sha256: 'f5006ddf207becaace1668113a61b31cf8b2e03f0f0baa0d1ca37eb8371d4bc1',
    sizeMB: 4200,
    label: 'Q8_0 (Best quality, ~4.2GB)'
  },
  'Q2_K': {
    filename: 'translategemma-4b-it.Q2_K.gguf',
    url: 'https://huggingface.co/mradermacher/translategemma-4b-it-GGUF/resolve/d37868f759d2f817a43d28dd80cf9f982ffa62fd/translategemma-4b-it.Q2_K.gguf',
    sha256: '37140b1cd9110a5a5f836d3c6cd2f31d424b5ac726bd043f965e511c67070406',
    sizeMB: 1800,
    label: 'Q2_K (Smallest, ~1.8GB)'
  }
}

export const GGUF_VARIANTS_12B: Record<string, GGUFVariant> = {
  'Q4_K_M': {
    filename: 'translategemma-12b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/bullerwins/translategemma-12b-it-GGUF/resolve/d7d1d8cc4ff53d4bc883ef33eae3894f07833b63/translategemma-12b-it-Q4_K_M.gguf',
    sha256: '9196d728812afbf5efc10b539298585725edc3a4ecc092c22fdde5bbaf41879e',
    sizeMB: 7300,
    label: 'Q4_K_M (Recommended, ~7.3GB)'
  },
  'Q3_K_L': {
    filename: 'translategemma-12b-it-Q3_K_L.gguf',
    url: 'https://huggingface.co/bullerwins/translategemma-12b-it-GGUF/resolve/d7d1d8cc4ff53d4bc883ef33eae3894f07833b63/translategemma-12b-it-Q3_K_L.gguf',
    sha256: '73e76c054259fe176fe111997670d98bafd9e39c7f1603c45d21d2dfb64fb32d',
    sizeMB: 6480,
    label: 'Q3_K_L (Smallest, ~6.5GB)'
  },
  'Q8_0': {
    filename: 'translategemma-12b-it-Q8_0.gguf',
    url: 'https://huggingface.co/bullerwins/translategemma-12b-it-GGUF/resolve/d7d1d8cc4ff53d4bc883ef33eae3894f07833b63/translategemma-12b-it-Q8_0.gguf',
    sha256: 'a1c57a783142858a6c992739793692cf9afbaaf738aa0993ada93fa9472ecbe1',
    sizeMB: 12500,
    label: 'Q8_0 (Best quality, ~12.5GB)'
  }
}

/** Get GGUF variants for the given model size */
export function getGGUFVariants(modelSize: SLMModelSize): Record<string, GGUFVariant> {
  return modelSize === '12b' ? GGUF_VARIANTS_12B : GGUF_VARIANTS_4B
}

// GGUF download lock uses shared activeDownloads map

/** Pinned SHA256 for a catalogued GGUF file, so callers that only know the filename still get verification */
function knownGGUFSha256(filename: string): string | undefined {
  const catalogues = [
    HUNYUAN_MT_VARIANTS,
    HUNYUAN_MT_15_VARIANTS,
    LFM2_VARIANTS,
    PLAMO_VARIANTS,
    GGUF_VARIANTS_4B,
    GGUF_VARIANTS_12B
  ]
  for (const catalogue of catalogues) {
    const hit = Object.values(catalogue).find((v) => v.filename === filename)
    if (hit) return hit.sha256
  }
  return undefined
}

/** Get the GGUF models subdirectory */
export function getGGUFDir(): string {
  const dir = join(getModelsDir(), 'gguf')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** Check if a GGUF model is downloaded */
export function isGGUFDownloaded(filename: string): boolean {
  return existsSync(join(getGGUFDir(), filename))
}

/**
 * Download a GGUF model with resume support, download lock, and optional SHA256 verification.
 */
export async function downloadGGUF(
  filename: string,
  url: string,
  onProgress?: (message: string) => void,
  sha256: string | undefined = knownGGUFSha256(filename)
): Promise<string> {
  const modelPath = join(getGGUFDir(), filename)

  if (existsSync(modelPath)) {
    return modelPath
  }

  // Serialize downloads via shared lock (#208)
  if (activeDownloads.has(filename)) {
    onProgress?.('Waiting for model download in progress...')
    return activeDownloads.get(filename)!
  }

  const downloadPromise = doDownloadWithResume(modelPath, url, filename, onProgress, sha256)
  activeDownloads.set(filename, downloadPromise)
  try {
    return await downloadPromise
  } finally {
    activeDownloads.delete(filename)
  }
}

/** Download with HTTP Range resume support */
async function doDownloadWithResume(
  modelPath: string,
  url: string,
  label: string,
  onProgress?: (message: string) => void,
  expectedSha256?: string
): Promise<string> {
  const partialPath = modelPath + '.partial'

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Check for partial download to resume
      let existingSize = 0
      if (existsSync(partialPath)) {
        existingSize = statSync(partialPath).size
        onProgress?.(`Resuming download from ${(existingSize / 1024 / 1024).toFixed(0)}MB...`)
      }

      const headers: Record<string, string> = {}
      if (existingSize > 0) {
        headers['Range'] = `bytes=${existingSize}-`
      }

      // 10-minute timeout for large model downloads
      const controller = new AbortController()
      const fetchTimeout = setTimeout(() => controller.abort(), 10 * 60_000)

      let response: Response
      try {
        response = await fetch(url, { redirect: 'follow', headers, signal: controller.signal })
      } finally {
        clearTimeout(fetchTimeout)
      }

      // If server doesn't support Range, start over
      if (response.status === 200 && existingSize > 0) {
        existingSize = 0
        try { unlinkSync(partialPath) } catch (e) { log.warn('Failed to remove partial file for restart:', e) }
      }

      if (!response.ok && response.status !== 206) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`)
      }

      const contentLength = Number(response.headers.get('content-length')) || 0
      const total = existingSize + contentLength
      const reader = response.body?.getReader()
      if (!reader) throw new Error('No response body')

      const ws = createWriteStream(partialPath, { flags: existingSize > 0 ? 'a' : 'w' })
      let downloaded = existingSize

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          ws.write(value)
          downloaded += value.length
          if (total > 0) {
            const pct = Math.round((downloaded / total) * 100)
            const mb = (downloaded / 1024 / 1024).toFixed(1)
            const totalMb = (total / 1024 / 1024).toFixed(0)
            onProgress?.(`Downloading ${label}... ${pct}% (${mb}/${totalMb} MB)`)
          }
        }
        ws.end()
        await new Promise<void>((resolve, reject) => {
          ws.on('finish', resolve)
          ws.on('error', reject)
        })
      } catch (err) {
        ws.end()
        throw err
      }

      // SHA256 verification (streaming to avoid loading multi-GB files into memory)
      if (!expectedSha256) {
        log.warn(`No SHA256 hash provided for ${label} — skipping integrity verification`)
      }
      if (expectedSha256) {
        onProgress?.('Verifying file integrity...')
        const { createReadStream } = await import('fs')
        const hash = await new Promise<string>((resolve, reject) => {
          const hasher = createHash('sha256')
          const stream = createReadStream(partialPath)
          stream.on('data', (chunk: string | Buffer) => hasher.update(chunk))
          stream.on('end', () => resolve(hasher.digest('hex')))
          stream.on('error', reject)
        })
        if (hash !== expectedSha256) {
          unlinkSync(partialPath)
          throw new Error(`SHA256 mismatch: expected ${expectedSha256}, got ${hash}`)
        }
      }

      // Rename partial to final
      const { rename } = await import('fs/promises')
      await rename(partialPath, modelPath)
      onProgress?.(`${label} download complete`)
      return modelPath

    } catch (err) {
      if (attempt >= MAX_RETRIES) {
        try { if (existsSync(partialPath)) unlinkSync(partialPath) } catch (e) { log.warn('Failed to clean up partial file after max retries:', e) }
        throw err
      }
      const delay = RETRY_DELAYS[attempt]
      const msg = err instanceof Error ? err.message : String(err)
      onProgress?.(`Download failed (${msg}), retrying in ${delay / 1000}s... (${attempt + 1}/${MAX_RETRIES})`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw new Error('Unreachable')
}

const MAX_RETRIES = 3
const RETRY_DELAYS = [3_000, 10_000, 30_000]

export async function downloadModel(
  onProgress?: (message: string) => void,
  variant?: WhisperVariant
): Promise<string> {
  const variantConfig = variant ? WHISPER_VARIANTS[variant] : null
  const modelPath = getModelPath(variant)
  const filename = variantConfig ? variantConfig.filename : MODEL_FILENAME
  const url = variantConfig ? variantConfig.url : MODEL_URL
  const sha256 = variantConfig ? variantConfig.sha256 : MODEL_SHA256
  const label = variantConfig
    ? `Whisper ${variantConfig.label} (~${variantConfig.sizeMB}MB)`
    : 'Whisper model (~540MB)'

  if (existsSync(modelPath)) {
    return modelPath
  }

  // Serialize downloads via shared lock (#208)
  if (activeDownloads.has(filename)) {
    onProgress?.('Waiting for model download in progress...')
    return activeDownloads.get(filename)!
  }

  const downloadPromise = doDownloadWithResume(modelPath, url, label, onProgress, sha256)
  activeDownloads.set(filename, downloadPromise)
  try {
    return await downloadPromise
  } finally {
    activeDownloads.delete(filename)
  }
}
