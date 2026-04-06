import { existsSync } from 'fs'
import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { SubprocessBridge, type SpawnConfig, type InitResult } from '../SubprocessBridge'
import {
  APPLE_TRANSLATE_INIT_TIMEOUT_MS,
  APPLE_TRANSLATE_COMMAND_TIMEOUT_MS
} from '../constants'

/**
 * Well-known paths where the apple-translate binary may be installed.
 * Users build from scripts/apple-translate/ and place the binary in their PATH.
 */
const APPLE_TRANSLATE_PATHS = [
  '/opt/homebrew/bin/apple-translate',
  '/usr/local/bin/apple-translate'
]

/**
 * Language pairs known to be supported by Apple Translation framework.
 * Used for early rejection of unsupported pairs before hitting the bridge.
 * Apple's supported set may expand over time — this is a conservative subset.
 */
const SUPPORTED_LANGUAGES: Set<Language> = new Set([
  'ja', 'en', 'zh', 'ko', 'fr', 'de', 'es', 'pt', 'ru', 'it', 'nl', 'pl', 'ar', 'th', 'vi', 'id'
])

/**
 * Apple Translation engine (macOS 26+ / Tahoe).
 *
 * Uses Apple's on-device Translation framework via a Swift CLI daemon
 * (scripts/apple-translate). The daemon communicates via JSON-over-stdio,
 * reusing TranslationSession instances for low-latency repeated calls.
 *
 * Key advantages:
 * - Zero model management (system handles downloads)
 * - ANE-optimized (Apple Neural Engine)
 * - Free, on-device, no API keys required
 * - Good JA<->EN quality for casual / real-time use
 *
 * Requires macOS 26 (Tahoe) or later.
 *
 * Build the CLI:
 *   cd scripts/apple-translate && swift build -c release
 *   cp .build/release/apple-translate /opt/homebrew/bin/
 */
export class AppleTranslator extends SubprocessBridge implements TranslatorEngine {
  readonly id = 'apple-translate'
  readonly name = 'Apple Translate (Built-in)'
  readonly isOffline = true

  private onProgress?: (message: string) => void
  private supportedLanguages: Set<string> = new Set()

  constructor(options?: {
    onProgress?: (message: string) => void
  }) {
    super()
    this.onProgress = options?.onProgress
  }

  protected getLogPrefix(): string {
    return '[apple-translate]'
  }

  protected getInitTimeout(): number {
    return APPLE_TRANSLATE_INIT_TIMEOUT_MS
  }

  protected getCommandTimeout(): number {
    return APPLE_TRANSLATE_COMMAND_TIMEOUT_MS
  }

  protected getSpawnConfig(): SpawnConfig {
    this.onProgress?.('Starting Apple Translate bridge...')

    const binaryPath = findAppleTranslateBinary()
    if (!binaryPath) {
      throw new Error(
        'apple-translate binary not found. Build from scripts/apple-translate: ' +
        'cd scripts/apple-translate && swift build -c release && ' +
        'cp .build/release/apple-translate /opt/homebrew/bin/'
      )
    }

    return {
      command: binaryPath,
      args: ['daemon'],
      initMessage: { action: 'languages' }
    }
  }

  protected getSpawnError(): Error {
    return new Error(
      'apple-translate binary not found. Build from scripts/apple-translate: ' +
      'cd scripts/apple-translate && swift build -c release && ' +
      'cp .build/release/apple-translate /opt/homebrew/bin/'
    )
  }

  protected onInitComplete(result: InitResult): void {
    const langs = result.languages as string[] | undefined
    if (langs && Array.isArray(langs)) {
      this.supportedLanguages = new Set(langs)
      this.log.info(`Supported languages: ${langs.join(', ')}`)
    }
    this.onProgress?.('Apple Translate ready')
  }

  protected onStatusMessage(status: string): void {
    this.onProgress?.(status)
  }

  /**
   * Check if a language pair is likely supported before sending to bridge.
   */
  isLanguageSupported(lang: Language): boolean {
    // If we got a language list from the bridge, use it
    if (this.supportedLanguages.size > 0) {
      return this.supportedLanguages.has(lang)
    }
    // Fallback to our static set
    return SUPPORTED_LANGUAGES.has(lang)
  }

  async translate(
    text: string,
    from: Language,
    to: Language,
    _context?: TranslateContext
  ): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text
    if (!this.process) {
      this.log.error(`Bridge not running for ${from}->${to}`)
      return ''
    }

    // Reject unsupported language pairs early
    if (!this.isLanguageSupported(from) || !this.isLanguageSupported(to)) {
      this.log.warn(`Unsupported language pair: ${from}->${to}`)
      return ''
    }

    try {
      const result = await this.sendCommand({
        action: 'translate',
        text,
        from,
        to
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

/** Find the apple-translate binary in well-known paths */
function findAppleTranslateBinary(): string | null {
  for (const p of APPLE_TRANSLATE_PATHS) {
    if (existsSync(p)) return p
  }
  return null
}
