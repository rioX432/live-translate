import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, unlinkSync } from 'fs'
import { writeFile } from 'fs/promises'

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

/**
 * Download a GGUF model from HuggingFace if not already present.
 * Reuses the same retry/progress infrastructure as Whisper model downloads.
 */
export async function downloadGGUF(
  filename: string,
  url: string,
  onProgress?: (message: string) => void
): Promise<string> {
  const modelPath = join(getModelsDir(), filename)

  if (existsSync(modelPath)) {
    return modelPath
  }

  onProgress?.(`Downloading ${filename}...`)
  return doDownloadGeneric(modelPath, url, filename, onProgress)
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
