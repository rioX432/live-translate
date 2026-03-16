import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'

export const MODEL_FILENAME = 'ggml-large-v3-turbo-q5_0.bin'
export const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILENAME}`

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

export async function downloadModel(
  onProgress?: (message: string) => void
): Promise<string> {
  const modelPath = getModelPath()

  if (existsSync(modelPath)) {
    return modelPath
  }

  onProgress?.('Downloading Whisper model (~600MB)...')

  const response = await fetch(MODEL_URL, { redirect: 'follow' })
  if (!response.ok) {
    throw new Error(`Failed to download model: ${response.status} ${response.statusText}`)
  }

  const total = Number(response.headers.get('content-length')) || 0
  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const chunks: Uint8Array[] = []
  let downloaded = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    downloaded += value.length
    if (total > 0) {
      const pct = Math.round((downloaded / total) * 100)
      onProgress?.(`Downloading model... ${pct}%`)
    }
  }

  const buffer = Buffer.concat(chunks)
  await writeFile(modelPath, buffer)
  onProgress?.('Model download complete')

  return modelPath
}
