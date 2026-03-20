import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, unlinkSync, statSync, createWriteStream } from 'fs'
import { writeFile } from 'fs/promises'
import { createHash } from 'crypto'

export const MODEL_FILENAME = 'ggml-kotoba-whisper-v2.0-q5_0.bin'
export const MODEL_URL =
  'https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-ggml/resolve/main/ggml-kotoba-whisper-v2.0-q5_0.bin'

// Global download lock — serializes all model downloads to prevent disk corruption (#208)
const activeDownloads = new Map<string, Promise<string>>()

export function getModelPath(): string {
  return join(getModelsDir(), MODEL_FILENAME)
}

export function getModelsDir(): string {
  const dir = join(app.getPath('userData'), 'models')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

export function isModelDownloaded(): boolean {
  return existsSync(getModelPath())
}

/** GGUF model variant configuration */
export interface GGUFVariant {
  filename: string
  url: string
  sha256?: string
  sizeMB: number
  label: string
}

/** Model size identifier for TranslateGemma */
export type SLMModelSize = '4b' | '12b'

export const GGUF_VARIANTS_4B: Record<string, GGUFVariant> = {
  'Q4_K_M': {
    filename: 'translategemma-4b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/google/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it-Q4_K_M.gguf',
    sizeMB: 2600,
    label: 'Q4_K_M (Recommended, ~2.6GB)'
  },
  'Q8_0': {
    filename: 'translategemma-4b-it-Q8_0.gguf',
    url: 'https://huggingface.co/google/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it-Q8_0.gguf',
    sizeMB: 4400,
    label: 'Q8_0 (Best quality, ~4.4GB)'
  },
  'Q2_K': {
    filename: 'translategemma-4b-it-Q2_K.gguf',
    url: 'https://huggingface.co/google/translategemma-4b-it-GGUF/resolve/main/translategemma-4b-it-Q2_K.gguf',
    sizeMB: 1400,
    label: 'Q2_K (Smallest, ~1.4GB)'
  }
}

export const GGUF_VARIANTS_12B: Record<string, GGUFVariant> = {
  'Q4_K_M': {
    filename: 'translategemma-12b-it-Q4_K_M.gguf',
    url: 'https://huggingface.co/bullerwins/translategemma-12b-it-GGUF/resolve/main/translategemma-12b-it-Q4_K_M.gguf',
    sizeMB: 7300,
    label: 'Q4_K_M (Recommended, ~7.3GB)'
  },
  'Q3_K_L': {
    filename: 'translategemma-12b-it-Q3_K_L.gguf',
    url: 'https://huggingface.co/bullerwins/translategemma-12b-it-GGUF/resolve/main/translategemma-12b-it-Q3_K_L.gguf',
    sizeMB: 6480,
    label: 'Q3_K_L (Smallest, ~6.5GB)'
  },
  'Q8_0': {
    filename: 'translategemma-12b-it-Q8_0.gguf',
    url: 'https://huggingface.co/bullerwins/translategemma-12b-it-GGUF/resolve/main/translategemma-12b-it-Q8_0.gguf',
    sizeMB: 12500,
    label: 'Q8_0 (Best quality, ~12.5GB)'
  }
}

/** Get GGUF variants for the given model size */
export function getGGUFVariants(modelSize: SLMModelSize): Record<string, GGUFVariant> {
  return modelSize === '12b' ? GGUF_VARIANTS_12B : GGUF_VARIANTS_4B
}

/** @deprecated Use getGGUFVariants() instead. Kept for backward compatibility. */
export const GGUF_VARIANTS: Record<string, GGUFVariant> = GGUF_VARIANTS_4B

// GGUF download lock uses shared activeDownloads map

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
  sha256?: string
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
        try { unlinkSync(partialPath) } catch { /* ignore */ }
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
        console.warn(`[model-downloader] No SHA256 hash provided for ${label} — skipping integrity verification`)
      }
      if (expectedSha256) {
        onProgress?.('Verifying file integrity...')
        const { createReadStream } = await import('fs')
        const hash = await new Promise<string>((resolve, reject) => {
          const hasher = createHash('sha256')
          const stream = createReadStream(partialPath)
          stream.on('data', (chunk: Buffer) => hasher.update(chunk))
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
        try { if (existsSync(partialPath)) unlinkSync(partialPath) } catch { /* ignore */ }
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
  onProgress?: (message: string) => void
): Promise<string> {
  const modelPath = getModelPath()

  if (existsSync(modelPath)) {
    return modelPath
  }

  // Serialize downloads via shared lock (#208)
  if (activeDownloads.has(MODEL_FILENAME)) {
    onProgress?.('Waiting for model download in progress...')
    return activeDownloads.get(MODEL_FILENAME)!
  }

  const downloadPromise = doDownloadWithResume(modelPath, MODEL_URL, 'Whisper model (~540MB)', onProgress)
  activeDownloads.set(MODEL_FILENAME, downloadPromise)
  try {
    return await downloadPromise
  } finally {
    activeDownloads.delete(MODEL_FILENAME)
  }
}
