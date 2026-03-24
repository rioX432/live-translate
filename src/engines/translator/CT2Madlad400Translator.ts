import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { SubprocessBridge, type SpawnConfig, type InitResult } from '../SubprocessBridge'

const TRANSLATE_TIMEOUT_MS = 15_000
const INIT_TIMEOUT_MS = 180_000

/**
 * CTranslate2-accelerated Madlad-400 translator (#262).
 *
 * Spawns a Python subprocess running ct2-madlad400-bridge.py which uses
 * CTranslate2 for fast multilingual translation with Madlad-400-3B.
 * Supports 450+ languages via language tags (e.g. "<2en> source text").
 * Uses a pre-converted int8 quantized model (~1.5GB) from HuggingFace.
 *
 * Requirements: pip install ctranslate2 sentencepiece huggingface_hub
 */
export class CT2Madlad400Translator extends SubprocessBridge implements TranslatorEngine {
  readonly id = 'ct2-madlad-400'
  readonly name = 'Madlad-400 (CTranslate2, 450+ Languages)'
  readonly isOffline = true

  private onProgress?: (message: string) => void

  constructor(options?: { onProgress?: (message: string) => void }) {
    super()
    this.onProgress = options?.onProgress
  }

  protected getLogPrefix(): string {
    return '[ct2-madlad-400]'
  }

  protected getInitTimeout(): number {
    return INIT_TIMEOUT_MS
  }

  protected getCommandTimeout(): number {
    return TRANSLATE_TIMEOUT_MS
  }

  protected getSpawnConfig(): SpawnConfig {
    this.onProgress?.('Starting CTranslate2 Madlad-400 bridge...')
    return {
      command: 'python3',
      args: [join(__dirname, '../../resources/ct2-madlad400-bridge.py')],
      initMessage: {
        action: 'init',
        model: 'Nextcloud-AI/madlad400-3b-mt-ct2-int8',
        device: 'auto'
      }
    }
  }

  protected getSpawnError(): Error {
    return new Error(
      'Python 3 not found. Install Python 3 and run: pip install ctranslate2 sentencepiece huggingface_hub'
    )
  }

  protected onInitComplete(result: InitResult): void {
    this.onProgress?.(
      `CTranslate2 Madlad-400 ready (device: ${result.device ?? 'cpu'}, quantization: ${result.quantization ?? 'int8'})`
    )
  }

  protected onStatusMessage(status: string): void {
    this.onProgress?.(status)
  }

  async translate(
    text: string,
    _from: Language,
    to: Language,
    _context?: TranslateContext
  ): Promise<string> {
    if (!text.trim()) return ''
    if (!this.process) {
      console.error(`[ct2-madlad-400] Bridge not running for translation to ${to}`)
      return ''
    }

    try {
      const result = await this.sendCommand({
        action: 'translate',
        text,
        target_lang: to
      })

      if (result.error) {
        console.error('[ct2-madlad-400] Translation error:', result.error)
        return ''
      }

      return (result.translated as string) || ''
    } catch (err) {
      console.error(
        '[ct2-madlad-400] Bridge error:',
        err instanceof Error ? err.message : err
      )
      return ''
    }
  }
}
