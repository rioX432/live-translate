import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, unlinkSync, statSync, createWriteStream } from 'fs'
import { readFile, writeFile } from 'fs/promises'
import { createHash } from 'crypto'

export const MODEL_FILENAME = 'ggml-kotoba-whisper-v2.0-q5_0.bin'
export const MODEL_URL =
  'https://huggingface.co/kotoba-tech/kotoba-whisper-v2.0-ggml/resolve/main/ggml-kotoba-whisper-v2.0-q5_0.bin'

// Download lock to prevent concurrent downloads (#25)
let downloadInProgress: Promise<string> | null = null

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

export const GGUF_VARIANTS: Record<string, GGUFVariant> = {
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

// GGUF download lock
let ggufDownloadInProgress: Promise<string> | null = null

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

  // Prevent concurrent GGUF downloads
  if (ggufDownloadInProgress) {
    onProgress?.('Waiting for model download in progress...')
    return ggufDownloadInProgress
  }

  ggufDownloadInProgress = doDownloadWithResume(modelPath, url, filename, onProgress, sha256)
  try {
    return await ggufDownloadInProgress
  } finally {
    ggufDownloadInProgress = null
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

      const response = await fetch(url, { redirect: 'follow', headers })

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

      // SHA256 verification
      if (expectedSha256) {
        onProgress?.('Verifying file integrity...')
        const fileBuffer = await readFile(partialPath)
        const hash = createHash('sha256').update(fileBuffer).digest('hex')
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

export async function downloadModel(
  onProgress?: (message: string) => void
): Promise<string> {
  const modelPath = getModelPath()

  if (existsSync(modelPath)) {
    return modelPath
  }

  // Prevent concurrent downloads — reuse in-flight promise (#25)
  if (downloadInProgress) {
    onProgress?.('Waiting for model download in progress...')
    return downloadInProgress
  }

  downloadInProgress = doDownload(modelPath, onProgress)
  try {
    return await downloadInProgress
  } finally {
    downloadInProgress = null
  }
}

const MAX_RETRIES = 3
const RETRY_DELAYS = [3_000, 10_000, 30_000]

async function doDownload(
  modelPath: string,
  onProgress?: (message: string) => void
): Promise<string> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await doDownloadAttempt(modelPath, onProgress)
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err
      const delay = RETRY_DELAYS[attempt]
      const msg = err instanceof Error ? err.message : String(err)
      onProgress?.(`Download failed (${msg}), retrying in ${delay / 1000}s... (${attempt + 1}/${MAX_RETRIES})`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw new Error('Unreachable')
}

async function doDownloadGeneric(
  modelPath: string,
  url: string,
  label: string,
  onProgress?: (message: string) => void
): Promise<string> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await doDownloadAttemptGeneric(modelPath, url, label, onProgress)
    } catch (err) {
      if (attempt >= MAX_RETRIES) throw err
      const delay = RETRY_DELAYS[attempt]
      const msg = err instanceof Error ? err.message : String(err)
      onProgress?.(`Download failed (${msg}), retrying in ${delay / 1000}s... (${attempt + 1}/${MAX_RETRIES})`)
      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }
  throw new Error('Unreachable')
}

async function doDownloadAttemptGeneric(
  modelPath: string,
  url: string,
  label: string,
  onProgress?: (message: string) => void
): Promise<string> {
  onProgress?.(`Downloading ${label}...`)

  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Failed to download ${label}: ${response.status} ${response.statusText}`)
  }

  const total = Number(response.headers.get('content-length')) || 0
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const chunks: Uint8Array[] = []
  let downloaded = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      downloaded += value.length
      if (total > 0) {
        const pct = Math.round((downloaded / total) * 100)
        const mb = (downloaded / 1024 / 1024).toFixed(1)
        const totalMb = (total / 1024 / 1024).toFixed(0)
        onProgress?.(`Downloading ${label}... ${pct}% (${mb}/${totalMb} MB)`)
      }
    }

    const buffer = Buffer.concat(chunks)
    await writeFile(modelPath, buffer)
    onProgress?.(`${label} download complete`)

    return modelPath
  } catch (err) {
    try {
      if (existsSync(modelPath)) {
        unlinkSync(modelPath)
      }
    } catch {
      // Ignore cleanup errors
    }
    throw err
  }
}

async function doDownloadAttempt(
  modelPath: string,
  onProgress?: (message: string) => void
): Promise<string> {
  onProgress?.('Downloading Whisper model (~540MB)...')

  const response = await fetch(MODEL_URL, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Failed to download model: ${response.status} ${response.statusText}`)
  }

  const total = Number(response.headers.get('content-length')) || 0
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const chunks: Uint8Array[] = []
  let downloaded = 0

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      downloaded += value.length
      if (total > 0) {
        const pct = Math.round((downloaded / total) * 100)
        const mb = (downloaded / 1024 / 1024).toFixed(1)
        const totalMb = (total / 1024 / 1024).toFixed(0)
        onProgress?.(`Downloading model... ${pct}% (${mb}/${totalMb} MB)`)
      }
    }

    const buffer = Buffer.concat(chunks)
    await writeFile(modelPath, buffer)
    onProgress?.('Model download complete')

    return modelPath
  } catch (err) {
    // Clean up partial file on failure (#26)
    try {
      if (existsSync(modelPath)) {
        unlinkSync(modelPath)
      }
    } catch {
      // Ignore cleanup errors
    }
    throw err
  }
}
