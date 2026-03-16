import { transcribe } from '@kutalia/whisper-node-addon'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { writeFile } from 'fs/promises'
import type { STTEngine, STTResult, Language } from '../types'

const MODEL_FILENAME = 'ggml-large-v3-turbo-q5_0.bin'
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILENAME}`

export class WhisperLocalEngine implements STTEngine {
  readonly id = 'whisper-local'
  readonly name = 'Whisper Local (large-v3-turbo)'
  readonly isOffline = true

  private modelPath = ''
  private onProgress?: (message: string) => void

  constructor(options?: { onProgress?: (message: string) => void }) {
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    const modelsDir = join(app.getPath('userData'), 'models')
    if (!existsSync(modelsDir)) {
      mkdirSync(modelsDir, { recursive: true })
    }

    this.modelPath = join(modelsDir, MODEL_FILENAME)

    if (!existsSync(this.modelPath)) {
      this.onProgress?.(`Downloading Whisper model (~600MB)...`)
      await this.downloadModel()
      this.onProgress?.('Model download complete')
    }
  }

  async processAudio(audioChunk: Float32Array, _sampleRate: number): Promise<STTResult | null> {
    if (!this.modelPath) throw new Error('Engine not initialized')

    try {
      // First pass: transcribe to get the original text and detect language
      const result = await transcribe({
        model: this.modelPath,
        pcmf32: audioChunk,
        language: 'auto',
        vad: true,
        no_timestamps: true,
        no_prints: true
      })

      const text = this.extractText(result.transcription)
      if (!text.trim()) return null

      // Detect language from the text content
      const language = this.detectLanguage(text)

      return {
        text,
        language,
        isFinal: true,
        timestamp: Date.now()
      }
    } catch (err) {
      console.error('Whisper transcription error:', err)
      return null
    }
  }

  async dispose(): Promise<void> {
    // whisper-node-addon doesn't require explicit cleanup
  }

  /**
   * Detect language by checking if text contains mostly Japanese characters.
   * Simple heuristic: if >30% of characters are CJK/Hiragana/Katakana → Japanese
   */
  private detectLanguage(text: string): Language {
    const japanesePattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\u3400-\u4DBF]/g
    const matches = text.match(japanesePattern)
    const japaneseRatio = (matches?.length || 0) / text.length
    return japaneseRatio > 0.3 ? 'ja' : 'en'
  }

  private extractText(transcription: string[][] | string[]): string {
    if (!transcription || transcription.length === 0) return ''
    // transcription can be string[] or string[][] depending on format
    if (Array.isArray(transcription[0])) {
      return (transcription as string[][]).map((seg) => seg[seg.length - 1] || '').join(' ')
    }
    return (transcription as string[]).join(' ')
  }

  private async downloadModel(): Promise<void> {
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
        this.onProgress?.(`Downloading model... ${pct}%`)
      }
    }

    const buffer = Buffer.concat(chunks)
    await writeFile(this.modelPath, buffer)
  }
}
