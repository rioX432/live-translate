import { join } from 'path'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { SubprocessBridge, type SpawnConfig, type InitResult } from '../SubprocessBridge'
import { ANE_TRANSLATE_TIMEOUT_MS, ANE_INIT_TIMEOUT_MS } from '../constants'

/**
 * ANEMLL Apple Neural Engine translator (#241).
 *
 * Spawns a Python subprocess running ane-translate-bridge.py which uses
 * ANEMLL to convert models to CoreML and run inference on the Apple Neural
 * Engine (ANE). ANE provides ~1/10 power consumption vs GPU and ~1/16
 * memory usage, ideal for battery-powered laptops.
 *
 * macOS with Apple Silicon only.
 *
 * Requirements: pip install anemll coremltools transformers pyyaml numpy torch
 */
export class ANETranslator extends SubprocessBridge implements TranslatorEngine {
  readonly id = 'ane-translate'
  readonly name = 'ANEMLL (Apple Neural Engine)'
  readonly isOffline = true

  private onProgress?: (message: string) => void
  private model: string

  constructor(options?: {
    model?: string
    onProgress?: (message: string) => void
  }) {
    super()
    this.model = options?.model ?? 'google/gemma-3-4b-it'
    this.onProgress = options?.onProgress
  }

  protected getLogPrefix(): string {
    return '[ane-translate]'
  }

  protected getInitTimeout(): number {
    return ANE_INIT_TIMEOUT_MS
  }

  protected getCommandTimeout(): number {
    return ANE_TRANSLATE_TIMEOUT_MS
  }

  protected getSpawnConfig(): SpawnConfig {
    this.onProgress?.('Starting ANEMLL bridge...')
    return {
      command: 'python3',
      args: [join(__dirname, '../../resources/ane-translate-bridge.py')],
      initMessage: {
        action: 'init',
        model: this.model,
        context_length: 512
      }
    }
  }

  protected getSpawnError(): Error {
    return new Error(
      'Python 3 not found. Install Python 3 and run: pip install anemll coremltools transformers pyyaml numpy torch'
    )
  }

  protected onInitComplete(result: InitResult): void {
    this.onProgress?.(
      `ANEMLL ready (ANE, context: ${result.context_length ?? 512}, monolithic: ${result.monolithic ?? false})`
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
      this.log.error(`Bridge not running for ${from}->${to}`)
      return ''
    }

    try {
      const result = await this.sendCommand({
        action: 'translate',
        text,
        from,
        to,
        context: context
          ? {
              previousSegments: context.previousSegments?.slice(-3),
              glossary: context.glossary
            }
          : undefined
      })

      if (result.error) {
        this.log.error('Translation error:', result.error)
        return ''
      }

      return (result.translated as string) || ''
    } catch (err) {
      this.log.error('Bridge error:', err instanceof Error ? err.message : err)
      return ''
    }
  }
}
