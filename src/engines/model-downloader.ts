import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, unlinkSync, statSync, createWriteStream } from 'fs'
import { createHash } from 'crypto'
import { createLogger } from '../main/logger'

const log = createLogger('model-downloader')

/** Whisper model variant identifier */
export type WhisperVariant = 'large-v3-turbo'

/** Whisper model variant configuration */
export interface WhisperVariantConfig {
  filename: string
  url: string
  sha256: string
  sizeMB: number
  label: string
  description: string
}

/**
 * whisper.cpp model for platforms without MLX (Windows, Intel Mac). large-v3-turbo
 * is multilingual, unlike the JA-only Kotoba checkpoint, so the addon's language
 * detection can tell JA from EN.
 */
export const WHISPER_VARIANTS: Record<WhisperVariant, WhisperVariantConfig> = {
  'large-v3-turbo': {
    filename: 'ggml-large-v3-turbo-q5_0.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-large-v3-turbo-q5_0.bin',
    sha256: '394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2',
    sizeMB: 600,
    label: 'Large v3 Turbo',
    description: 'Multilingual, ~600MB'
  }
}

export const DEFAULT_WHISPER_VARIANT: WhisperVariant = 'large-v3-turbo'

// Global download lock — serializes all model downloads to prevent disk corruption (#208)
const activeDownloads = new Map<string, Promise<string>>()

export function getModelPath(variant: WhisperVariant = DEFAULT_WHISPER_VARIANT): string {
  return join(getModelsDir(), WHISPER_VARIANTS[variant].filename)
}

export function getModelsDir(): string {
  const dir = join(app.getPath('userData'), 'models')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function isModelDownloaded(variant: WhisperVariant = DEFAULT_WHISPER_VARIANT): boolean {
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

/**
 * Hy-MT2-1.8B (Apache-2.0), the translation model on every platform.
 * Q4_K_M: https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF
 */
export const HY_MT2_MODEL: GGUFVariant = {
  filename: 'Hy-MT2-1.8B-Q4_K_M.gguf',
  url: 'https://huggingface.co/tencent/Hy-MT2-1.8B-GGUF/resolve/a0c709d9fac510f2c807aa3af52872340dc37a4a/Hy-MT2-1.8B-Q4_K_M.gguf',
  sha256: 'dc5f44fcf1fa496ee7ad725982c0c8c553a4de00259b53af84c4b89fb0c06699',
  sizeMB: 1100,
  label: 'Hy-MT2-1.8B Q4_K_M'
}

/** TranslateGemma GGUF variants, used only for meeting summaries */

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
    { hyMt2: HY_MT2_MODEL },
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

  return withDownloadLock(filename, onProgress, () =>
    doDownloadWithResume(modelPath, url, filename, onProgress, sha256)
  )
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
  variant: WhisperVariant = DEFAULT_WHISPER_VARIANT
): Promise<string> {
  const config = WHISPER_VARIANTS[variant]
  const modelPath = getModelPath(variant)
  if (existsSync(modelPath)) {
    return modelPath
  }
  return withDownloadLock(config.filename, onProgress, () =>
    doDownloadWithResume(modelPath, config.url, `Whisper ${config.label} (~${config.sizeMB}MB)`, onProgress, config.sha256)
  )
}

/** One file of a multi-file model repository */
export interface PinnedRepoFile {
  name: string
  sha256: string
}

/** A model that is a directory of files from one Hugging Face commit */
export interface PinnedRepoModel {
  repo: string
  revision: string
  dirName: string
  label: string
  /** Approximate total download size */
  sizeMB: number
  files: PinnedRepoFile[]
}

/**
 * Qwen3-ASR 0.6B (Apache-2.0) in MLX 8-bit, loaded by the Apple Silicon STT helper.
 * https://huggingface.co/mlx-community/Qwen3-ASR-0.6B-8bit
 */
export const QWEN3_ASR_MODEL: PinnedRepoModel = {
  repo: 'mlx-community/Qwen3-ASR-0.6B-8bit',
  revision: '89e96d92ba34aca20b3e29fb10cc284097d1219f',
  dirName: 'qwen3-asr-0.6b-8bit',
  label: 'Qwen3-ASR 0.6B (~1GB)',
  sizeMB: 1000,
  files: [
    { name: 'config.json', sha256: '5d104a945fed08728ab010f12bf3ce5ab4d0794bba276d81bff5bd83ae9d2be0' },
    { name: 'model.safetensors', sha256: 'b5bfe4abc1b4c6e58b633096682ec2b6297298add1527119936107d211adf0e8' },
    { name: 'model.safetensors.index.json', sha256: 'caa32ece76c395ba241533eb4aceb0efbc72488ef3d8d2fd3c677ce068dad57d' },
    { name: 'merges.txt', sha256: '8831e4f1a044471340f7c0a83d7bd71306a5b867e95fd870f74d0c5308a904d5' },
    { name: 'vocab.json', sha256: 'ca10d7e9fb3ed18575dd1e277a2579c16d108e32f27439684afa0e10b1440910' },
    { name: 'tokenizer_config.json', sha256: '4942d005604266809309cabc9f4e9cb89ce855d59b14681fdc0e1cc62ea26c4c' },
    { name: 'preprocessor_config.json', sha256: '45e120a4eda2c20c5d7f2ea9354e63536bf35e27aa573fb7cdf78017b378770d' },
    { name: 'chat_template.json', sha256: '75a8cfca24f00de72d796fbfed6858fc9614ef3dabd8696684cc3bc03a9c58ff' },
    { name: 'generation_config.json', sha256: '1da527824d81e07118facff437e03f2e24a23311e3bdeb2368973fe77e5f275c' }
  ]
}

export function pinnedRepoFileUrl(model: PinnedRepoModel, file: PinnedRepoFile): string {
  return `https://huggingface.co/${model.repo}/resolve/${model.revision}/${file.name}`
}

export function getPinnedRepoDir(model: PinnedRepoModel): string {
  return join(getModelsDir(), model.dirName)
}

export function isPinnedRepoDownloaded(model: PinnedRepoModel): boolean {
  const dir = getPinnedRepoDir(model)
  return model.files.every((f) => existsSync(join(dir, f.name)))
}

/** Download every file of a pinned repository model; files already present are kept. */
export async function downloadPinnedRepo(
  model: PinnedRepoModel,
  onProgress?: (message: string) => void
): Promise<string> {
  const dir = getPinnedRepoDir(model)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return withDownloadLock(model.dirName, onProgress, async () => {
    for (const file of model.files) {
      const target = join(dir, file.name)
      if (existsSync(target)) continue
      await doDownloadWithResume(target, pinnedRepoFileUrl(model, file), `${model.label}: ${file.name}`, onProgress, file.sha256)
    }
    return dir
  })
}

/** Serialize downloads of the same target through the shared lock (#208) */
async function withDownloadLock(
  key: string,
  onProgress: ((message: string) => void) | undefined,
  run: () => Promise<string>
): Promise<string> {
  const active = activeDownloads.get(key)
  if (active) {
    onProgress?.('Waiting for model download in progress...')
    return active
  }
  const downloadPromise = run()
  activeDownloads.set(key, downloadPromise)
  try {
    return await downloadPromise
  } finally {
    activeDownloads.delete(key)
  }
}
