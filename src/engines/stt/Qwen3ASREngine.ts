import { existsSync } from 'fs'
import { join } from 'path'
import type { STTEngine, STTResult, Language } from '../types'
import { ResidentProcess, type SpawnFn } from '../ResidentProcess'
import { QWEN3_ASR_MODEL, downloadPinnedRepo } from '../model-downloader'
import { createLogger } from '../../main/logger'
import {
  QWEN3_ASR_READY_TIMEOUT_MS,
  QWEN3_ASR_REQUEST_TIMEOUT_MS,
  QWEN3_ASR_MAX_RESTARTS
} from '../constants'

const log = createLogger('qwen3-asr')

const HELPER_DIR = 'qwen3-asr-helper'
const HELPER_BINARY = 'qwen3-asr-helper'
const EXPECTED_SAMPLE_RATE = 16_000

/** Language names Qwen3-ASR reports, mapped to the app's codes. */
const QWEN3_LANGUAGE_CODES: Record<string, Language> = {
  japanese: 'ja',
  english: 'en',
  chinese: 'zh',
  cantonese: 'zh',
  korean: 'ko',
  french: 'fr',
  german: 'de',
  spanish: 'es',
  portuguese: 'pt',
  russian: 'ru',
  italian: 'it',
  dutch: 'nl',
  polish: 'pl',
  arabic: 'ar',
  thai: 'th',
  vietnamese: 'vi',
  indonesian: 'id'
}

/**
 * Map the helper's `language` field to a Language. Long audio is decoded in chunks and
 * the names come back comma-joined; the first chunk decides. Unknown or missing names
 * fall back to the script, which is reliable for the JA/EN case the app targets.
 */
export function mapQwen3Language(name: string, text: string): Language {
  const first = name.split(',')[0]?.trim().toLowerCase() ?? ''
  const code = QWEN3_LANGUAGE_CODES[first]
  if (code) return code
  return /[぀-ヿ一-鿿]/.test(text) ? 'ja' : 'en'
}

/** Packaged builds ship the helper in Resources/ (electron-builder extraResources). */
export function resolveQwen3HelperPath(isPackaged: boolean, resourcesPath: string, projectRoot: string): string {
  return isPackaged
    ? join(resourcesPath, HELPER_DIR, HELPER_BINARY)
    : join(projectRoot, 'resources', 'bin', HELPER_DIR, HELPER_BINARY)
}

function defaultHelperPath(): string {
  const { app } = require('electron')
  // Dev: __dirname is out/main/ after electron-vite bundles the main process.
  return resolveQwen3HelperPath(app.isPackaged, process.resourcesPath, join(__dirname, '../..'))
}

function encodePcm(samples: Float32Array): string {
  return Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength).toString('base64')
}

/**
 * Qwen3-ASR 0.6B (8-bit MLX) on Apple Silicon through a resident Swift helper
 * (scripts/qwen3-asr-helper), so no Python install is needed and the model stays
 * loaded between segments.
 */
export class Qwen3ASREngine implements STTEngine {
  readonly id = 'qwen3-asr'
  readonly name = 'Qwen3-ASR 0.6B (Apple Silicon)'
  readonly isOffline = true

  private helper: ResidentProcess | null = null
  private initPromise: Promise<void> | null = null
  private readonly onProgress?: (message: string) => void
  private readonly helperPath?: string
  private readonly modelDir?: string
  private readonly spawnFn?: SpawnFn

  constructor(options?: {
    onProgress?: (message: string) => void
    /** Overrides for tests and the bench harness */
    helperPath?: string
    modelDir?: string
    spawnFn?: SpawnFn
  }) {
    this.onProgress = options?.onProgress
    this.helperPath = options?.helperPath
    this.modelDir = options?.modelDir
    this.spawnFn = options?.spawnFn
  }

  initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInitialize().catch((err) => {
        this.initPromise = null
        throw err
      })
    }
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    const helperPath = this.helperPath ?? defaultHelperPath()
    if (!this.spawnFn && !existsSync(helperPath)) {
      throw new Error(`Qwen3-ASR helper not found at ${helperPath}. Run scripts/build-qwen3-asr-helper.sh`)
    }
    const modelDir = this.modelDir ?? await downloadPinnedRepo(QWEN3_ASR_MODEL, this.onProgress)

    this.onProgress?.('Loading Qwen3-ASR 0.6B...')
    const helper = new ResidentProcess({
      command: helperPath,
      args: [modelDir],
      name: 'qwen3-asr-helper',
      readyTimeoutMs: QWEN3_ASR_READY_TIMEOUT_MS,
      requestTimeoutMs: QWEN3_ASR_REQUEST_TIMEOUT_MS,
      maxRestarts: QWEN3_ASR_MAX_RESTARTS,
      spawnFn: this.spawnFn
    })
    try {
      await helper.start()
    } catch (err) {
      await helper.dispose()
      throw err
    }
    this.helper = helper
    this.onProgress?.('Qwen3-ASR 0.6B ready')
  }

  async processAudio(audioChunk: Float32Array, sampleRate: number): Promise<STTResult | null> {
    if (!this.helper) throw new Error('[qwen3-asr] Not initialized')
    if (audioChunk.length === 0) return null
    if (sampleRate !== EXPECTED_SAMPLE_RATE) {
      throw new Error(`[qwen3-asr] Expected ${EXPECTED_SAMPLE_RATE} Hz audio, got ${sampleRate}`)
    }

    let reply: Record<string, unknown>
    try {
      reply = await this.helper.request({ pcm_f32_b64: encodePcm(audioChunk) })
    } catch (err) {
      log.error('Transcription failed:', err instanceof Error ? err.message : err)
      throw err
    }
    if (typeof reply.error === 'string') {
      log.error('Helper reported an error:', reply.error)
      throw new Error(`[qwen3-asr] ${reply.error}`)
    }

    const text = typeof reply.text === 'string' ? reply.text.trim() : ''
    log.debug(`samples=${audioChunk.length} textLen=${text.length} ms=${reply.ms}`)
    if (!text) return null

    return {
      text,
      language: mapQwen3Language(typeof reply.language === 'string' ? reply.language : '', text),
      isFinal: true,
      timestamp: Date.now()
    }
  }

  async dispose(): Promise<void> {
    const helper = this.helper
    this.helper = null
    this.initPromise = null
    await helper?.dispose()
  }
}
