import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { SubprocessBridge, type SpawnConfig, type InitResult } from '../SubprocessBridge'
import { CT2_OPUS_MT_TRANSLATE_TIMEOUT_MS, CT2_OPUS_MT_INIT_TIMEOUT_MS } from '../constants'

/**
 * CTranslate2-accelerated OPUS-MT translator (#242).
 *
 * Spawns a Python subprocess running ct2-opus-mt-bridge.py which uses
 * CTranslate2 for 6-10x faster inference compared to ONNX-based OPUS-MT.
 * Model conversion from HuggingFace format to CTranslate2 is handled
 * automatically on first run and cached for subsequent launches.
 *
 * Requirements: pip install ctranslate2 transformers sentencepiece
 */
export class CT2OpusMTTranslator extends SubprocessBridge implements TranslatorEngine {
  readonly id = 'ct2-opus-mt'
  readonly name = 'OPUS-MT (CTranslate2 Accelerated)'
  readonly isOffline = true

  private onProgress?: (message: string) => void

  constructor(options?: { onProgress?: (message: string) => void }) {
    super()
    this.onProgress = options?.onProgress
  }

  protected getLogPrefix(): string {
    return '[ct2-opus-mt]'
  }

  protected getInitTimeout(): number {
    return CT2_OPUS_MT_INIT_TIMEOUT_MS
  }

  protected getCommandTimeout(): number {
    return CT2_OPUS_MT_TRANSLATE_TIMEOUT_MS
  }

  protected getSpawnConfig(): SpawnConfig {
    this.onProgress?.('Starting CTranslate2 OPUS-MT bridge...')
    return {
      command: 'python3',
      args: [join(__dirname, '../../resources/ct2-opus-mt-bridge.py')],
      initMessage: {
        action: 'init',
        model_ja_en: 'Helsinki-NLP/opus-mt-ja-en',
        model_en_ja: 'Helsinki-NLP/opus-mt-en-jap',
        device: 'auto',
        quantization: 'int8'
      }
    }
  }

  protected getSpawnError(): Error {
    return new Error(
      'Python 3 not found. Install Python 3 and run: pip install ctranslate2 transformers sentencepiece'
    )
  }

  protected onInitComplete(result: InitResult): void {
    this.onProgress?.(
      `CTranslate2 OPUS-MT ready (device: ${result.device ?? 'cpu'}, quantization: ${result.quantization ?? 'int8'})`
    )
  }

  protected onStatusMessage(status: string): void {
    this.onProgress?.(status)
  }

  async translate(
    text: string,
    from: Language,
    to: Language,
    context?: TranslateContext
  ): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text
    if (!this.process) {
      console.error(`[ct2-opus-mt] Bridge not running for ${from}->${to}`)
      return ''
    }

    // Apply glossary term replacements before translation
    let input = text
    if (context?.glossary?.length) {
      for (const entry of context.glossary) {
        if (entry.source?.trim() && input.includes(entry.source)) {
          input = input.replaceAll(entry.source, entry.target)
        }
      }
    }

    const direction = from === 'ja' ? 'ja-en' : 'en-ja'

    try {
      const result = await this.sendCommand({
        action: 'translate',
        text: input,
        direction
      })

      if (result.error) {
        console.error('[ct2-opus-mt] Translation error:', result.error)
        return ''
      }

      return (result.translated as string) || ''
    } catch (err) {
      console.error(
        '[ct2-opus-mt] Bridge error:',
        err instanceof Error ? err.message : err
      )
      return ''
    }
  }
}
