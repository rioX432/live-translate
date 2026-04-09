import { app } from 'electron'
import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { isHallucination } from './hallucination-filter'
import { applyGlossary } from './glossary-utils'
import { createLogger } from '../../main/logger'

const log = createLogger('onnx-web')

/**
 * ONNX Runtime Web translator using NLLB-200 distilled 600M via
 * @huggingface/transformers with WebGPU acceleration and WASM fallback (#556).
 *
 * Execution provider hierarchy:
 *   1. WebGPU  — ~20x faster than WASM, requires GPU + WebGPU support
 *   2. WASM    — universal fallback, runs on all platforms
 *
 * This engine serves as automatic fallback when native addons
 * (node-llama-cpp, whisper-node-addon) fail to load on platforms
 * without proper build toolchains (e.g. Windows without MSVC, Linux ARM).
 *
 * Uses NLLB-200 (No Language Left Behind) for broad multilingual support
 * (200+ languages) vs OPUS-MT which only supports specific language pairs.
 *
 * Known issue: WebGPU + q8 decoder produces gibberish for seq2seq models
 * (Transformers.js #1317). Workaround: use fp32 dtype on WebGPU, q8 on WASM.
 */
export class OnnxWebTranslator implements TranslatorEngine {
  readonly id = 'onnx-web'
  readonly name = 'NLLB-200 (ONNX Web)'
  readonly isOffline = true

  private pipeline: ((text: string, options: Record<string, unknown>) => Promise<Array<{ translation_text: string }>>) & {
    dispose(): Promise<void>
  } | null = null
  private initPromise: Promise<void> | null = null
  private onProgress?: (message: string) => void
  private activeBackend: 'webgpu' | 'wasm' | null = null

  constructor(options?: { onProgress?: (message: string) => void }) {
    this.onProgress = options?.onProgress
  }

  async initialize(): Promise<void> {
    if (this.initPromise) return this.initPromise
    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    if (this.pipeline) return

    const { pipeline, env } = await import('@huggingface/transformers')
    env.cacheDir = join(app.getPath('userData'), 'models', 'transformers')

    // Try WebGPU first, fall back to WASM
    const pipelineCreated = await this.tryCreatePipeline(pipeline, 'webgpu')
      ?? await this.tryCreatePipeline(pipeline, 'wasm')

    if (!pipelineCreated) {
      this.initPromise = null
      throw new Error('Failed to create NLLB-200 pipeline with any backend')
    }
  }

  private async tryCreatePipeline(
    pipelineFn: typeof import('@huggingface/transformers')['pipeline'],
    device: 'webgpu' | 'wasm'
  ): Promise<boolean> {
    try {
      this.onProgress?.(`Loading NLLB-200 600M (${device.toUpperCase()})...`)

      // WebGPU + q8 decoder produces gibberish for seq2seq models
      // (Transformers.js #1317). Use fp32 on WebGPU, q8 on WASM.
      const dtype = device === 'webgpu' ? 'fp32' : 'q8'

      const pipe = await pipelineFn('translation', 'Xenova/nllb-200-distilled-600M', {
        device,
        dtype,
        progress_callback: (progress: { status: string; file?: string; progress?: number }) => {
          if (progress.status === 'progress' && progress.file && progress.progress != null) {
            this.onProgress?.(`Downloading ${progress.file}: ${Math.round(progress.progress)}%`)
          }
        }
      })

      // Validate the pipeline works with a simple test translation
      const testResult = await (pipe as CallableFunction)('Hello', {
        src_lang: 'eng_Latn',
        tgt_lang: 'jpn_Jpan'
      }) as Array<{ translation_text: string }>

      if (!testResult?.[0]?.translation_text) {
        log.warn(`${device} pipeline produced empty test result, falling back`)
        await (pipe as unknown as { dispose(): Promise<void> }).dispose()
        return false
      }

      this.pipeline = pipe as unknown as typeof this.pipeline
      this.activeBackend = device
      this.onProgress?.(`NLLB-200 ready (${device.toUpperCase()})`)
      log.info(`Initialized with ${device} backend, dtype=${dtype}`)
      return true
    } catch (err) {
      log.warn(`Failed to create pipeline with ${device}:`, err instanceof Error ? err.message : err)
      return false
    }
  }

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text

    const trimmed = text.trim()
    if (trimmed.length < 3) return ''

    const input = applyGlossary(text, context?.glossary)

    if (!this.pipeline) {
      log.error('Pipeline not initialized')
      return ''
    }

    const srcLang = toNllbCode(from)
    const tgtLang = toNllbCode(to)
    if (!srcLang || !tgtLang) {
      log.warn(`Unsupported language pair: ${from}→${to}`)
      return ''
    }

    try {
      const t0 = performance.now()
      const result = await this.pipeline(input, {
        src_lang: srcLang,
        tgt_lang: tgtLang
      })
      const translated = result[0]?.translation_text || ''
      const ms = performance.now() - t0
      log.info(`translate ${from}→${to} backend=${this.activeBackend} inputLen=${trimmed.length} outputLen=${translated.length} time=${ms.toFixed(0)}ms`)

      if (isHallucination(trimmed, translated, from, to)) {
        log.warn(`Hallucination detected: "${trimmed}" → "${translated.substring(0, 80)}..." (filtered)`)
        return ''
      }

      return translated
    } catch (err) {
      log.error('Translation error:', err instanceof Error ? err.message : err)
      return ''
    }
  }

  async dispose(): Promise<void> {
    log.info('Disposing resources')
    try {
      await this.pipeline?.dispose()
    } catch (err) {
      log.error('Error during disposal:', err)
    }
    this.pipeline = null
    this.activeBackend = null
    this.initPromise = null
  }
}

/**
 * Map ISO 639-1 language codes to NLLB-200 BCP-47 language codes.
 * NLLB uses script-tagged codes (e.g. "eng_Latn", "jpn_Jpan").
 *
 * @see https://github.com/facebookresearch/flores/blob/main/flores200/README.md
 */
function toNllbCode(lang: Language): string | null {
  const map: Record<Language, string> = {
    ja: 'jpn_Jpan',
    en: 'eng_Latn',
    zh: 'zho_Hans',
    ko: 'kor_Hang',
    fr: 'fra_Latn',
    de: 'deu_Latn',
    es: 'spa_Latn',
    pt: 'por_Latn',
    ru: 'rus_Cyrl',
    it: 'ita_Latn',
    nl: 'nld_Latn',
    pl: 'pol_Latn',
    ar: 'arb_Arab',
    th: 'tha_Thai',
    vi: 'vie_Latn',
    id: 'ind_Latn'
  }
  return map[lang] ?? null
}
