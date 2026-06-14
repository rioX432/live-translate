import type { TranslatorEngine, Language, TranslateContext } from '../types'
import { createLogger } from '../../main/logger'

const log = createLogger('rotation')

export interface ProviderConfig {
  engine: TranslatorEngine
  monthlyCharLimit: number
}

export interface QuotaRecord {
  monthKey: string
  charCount: number
}

export interface QuotaStore {
  [providerId: string]: QuotaRecord
}

export interface QuotaPersistence {
  load(): QuotaStore
  save(quota: QuotaStore): void
}

/** Optional rotation behavior knobs (#703) */
export interface ApiRotationOptions {
  /**
   * Engine used when every cloud provider has been exhausted or is on
   * cooldown. When omitted, exhaustion throws (backward-compatible).
   */
  fallbackEngine?: TranslatorEngine
  /**
   * Cooldown applied to a provider that emitted a short-window rate-limit
   * (429 Rate limit). Defaults to 60_000 ms.
   */
  shortFailureCooldownMs?: number
}

/**
 * Wraps multiple TranslatorEngine instances with automatic fallback.
 * Tracks character usage per provider per month and skips exhausted providers.
 */
export class ApiRotationController implements TranslatorEngine {
  readonly id = 'rotation-controller'
  readonly name = 'API Rotation Controller'
  readonly isOffline = false

  private providers: ProviderConfig[]
  private persistence: QuotaPersistence
  private quota: QuotaStore = {}
  private onStatusUpdate?: (message: string) => void
  private failureCount = new Map<string, number>() // #40: track transient failures
  private failureDisabledAt = new Map<string, number>() // #94: cooldown tracking
  private rateLimitedUntil = new Map<string, number>() // #703: short cooldown for 429 rate-limit
  private static readonly MAX_CONSECUTIVE_FAILURES = 5
  private static readonly FAILURE_COOLDOWN_MS = 5 * 60_000 // 5 minutes
  private static readonly DEFAULT_SHORT_FAILURE_COOLDOWN_MS = 60_000 // #703: 60s default
  private initialized = false
  private initializedProviders = new Set<string>()
  private fallbackEngine?: TranslatorEngine
  private fallbackInitialized = false
  private shortFailureCooldownMs: number

  constructor(
    providers: ProviderConfig[],
    persistence: QuotaPersistence,
    onStatusUpdate?: (message: string) => void,
    options?: ApiRotationOptions
  ) {
    this.providers = providers
    this.persistence = persistence
    this.onStatusUpdate = onStatusUpdate
    this.quota = persistence.load() || {}
    this.fallbackEngine = options?.fallbackEngine
    this.shortFailureCooldownMs =
      options?.shortFailureCooldownMs ?? ApiRotationController.DEFAULT_SHORT_FAILURE_COOLDOWN_MS
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    const errors: Array<{ id: string; error: Error }> = []

    for (const provider of this.providers) {
      try {
        await provider.engine.initialize()
        this.initializedProviders.add(provider.engine.id)
      } catch (err) {
        errors.push({
          id: provider.engine.id,
          error: err instanceof Error ? err : new Error(String(err))
        })
        log.warn(`${provider.engine.id} init failed:`, err)
      }
    }

    if (this.initializedProviders.size === 0) {
      throw new Error(`All rotation providers failed: ${errors.map((e) => `${e.id}: ${e.error.message}`).join('; ')}`)
    }
    if (errors.length > 0) {
      this.onStatusUpdate?.(`Some providers failed to initialize: ${errors.map((e) => e.id).join(', ')}`)
    }
    this.initialized = true
  }

  async translate(text: string, from: Language, to: Language, context?: TranslateContext): Promise<string> {
    if (!text.trim()) return ''
    if (from === to) return text

    const currentMonth = this.getCurrentMonthKey()
    const charCount = text.length
    const errors: string[] = []

    for (const provider of this.providers) {
      const providerId = provider.engine.id

      // Skip providers that failed to initialize (#219)
      if (!this.initializedProviders.has(providerId)) continue

      const record = this.getQuotaRecord(providerId, currentMonth)

      // Skip if quota exhausted
      if (record.charCount >= provider.monthlyCharLimit) {
        continue
      }

      // #40: skip if too many consecutive transient failures (with cooldown #94)
      const failures = this.failureCount.get(providerId) ?? 0
      if (failures >= ApiRotationController.MAX_CONSECUTIVE_FAILURES) {
        const disabledAt = this.failureDisabledAt.get(providerId) ?? 0
        if (Date.now() - disabledAt < ApiRotationController.FAILURE_COOLDOWN_MS) {
          continue
        }
        // Cooldown elapsed — reset and retry
        this.failureCount.set(providerId, 0)
        this.failureDisabledAt.delete(providerId)
        log.info(`${providerId}: cooldown elapsed, re-enabling`)
      }

      // #703: skip if currently rate-limited (short cooldown for 429 rate-limit)
      const rateLimitedUntil = this.rateLimitedUntil.get(providerId) ?? 0
      if (rateLimitedUntil > Date.now()) {
        continue
      } else if (rateLimitedUntil > 0) {
        // Rate-limit cooldown elapsed — clear it
        this.rateLimitedUntil.delete(providerId)
      }

      // Warn if approaching limit (90%)
      const usageRatio = record.charCount / provider.monthlyCharLimit
      if (usageRatio >= 0.9 && usageRatio < 1) {
        log.warn(`${providerId}: ${Math.round(usageRatio * 100)}% quota used (${record.charCount}/${provider.monthlyCharLimit})`)
      }

      try {
        const result = await provider.engine.translate(text, from, to, context)

        // Track usage after successful translation
        record.charCount += charCount
        this.quota[providerId] = record
        this.persistence.save(this.quota)

        // Reset failure count on success (#40)
        this.failureCount.set(providerId, 0)

        return result
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        errors.push(`${providerId}: ${message}`)
        log.error(`${providerId} failed:`, message)

        // #703: classify into quota / rate-limit / generic transient failure
        const isQuotaError =
          message.includes('Quota exceeded') || message.includes('456')
        const isRateLimitError = message.includes('Rate limit')

        // Mark as exhausted on quota errors
        if (isQuotaError) {
          record.charCount = provider.monthlyCharLimit
          this.quota[providerId] = record
          this.persistence.save(this.quota)
          // Quota errors do not count toward transient failure budget.
          this.failureCount.set(providerId, 0)
        } else if (isRateLimitError) {
          // Short cooldown; do not count toward transient failure budget.
          this.rateLimitedUntil.set(providerId, Date.now() + this.shortFailureCooldownMs)
          log.warn(`${providerId}: rate-limited, cooldown ${this.shortFailureCooldownMs}ms`)
          this.failureCount.set(providerId, 0)
        } else {
          // #40: track consecutive failures for generic transient errors
          const currentFailures = (this.failureCount.get(providerId) ?? 0) + 1
          this.failureCount.set(providerId, currentFailures)
          if (currentFailures >= ApiRotationController.MAX_CONSECUTIVE_FAILURES) {
            this.failureDisabledAt.set(providerId, Date.now())
            log.warn(`${providerId}: disabled after ${currentFailures} consecutive failures (cooldown 5min)`)
            this.onStatusUpdate?.(`${provider.engine.name} temporarily disabled after repeated failures`)
          }
        }

        // Continue to next provider
      }
    }

    // #703: fall back to local engine when all cloud providers are exhausted
    if (this.fallbackEngine) {
      this.onStatusUpdate?.('All cloud providers exhausted, using local fallback')
      log.info(`Falling back to ${this.fallbackEngine.id}. Errors: ${errors.join('; ')}`)
      if (!this.fallbackInitialized) {
        await this.fallbackEngine.initialize()
        this.fallbackInitialized = true
      }
      return await this.fallbackEngine.translate(text, from, to, context)
    }

    this.onStatusUpdate?.('Translation quota exhausted — all providers used up')
    const errorMsg = `All translation providers exhausted. Errors: ${errors.join('; ')}`
    throw new Error(errorMsg)
  }

  async dispose(): Promise<void> {
    for (const provider of this.providers) {
      await provider.engine.dispose().catch((err) => {
        log.warn(`Error disposing ${provider.engine.id}:`, err)
      })
    }
    // #703: dispose the lazily-initialized fallback engine too
    if (this.fallbackEngine && this.fallbackInitialized) {
      await this.fallbackEngine.dispose().catch((err) => {
        log.warn(`Error disposing fallback ${this.fallbackEngine?.id}:`, err)
      })
      this.fallbackInitialized = false
    }
  }

  /** Get quota usage summary for UI display */
  getQuotaSummary(): Array<{
    id: string
    name: string
    used: number
    limit: number
    exhausted: boolean
  }> {
    const currentMonth = this.getCurrentMonthKey()
    return this.providers.map((p) => {
      const record = this.getQuotaRecord(p.engine.id, currentMonth)
      return {
        id: p.engine.id,
        name: p.engine.name,
        used: record.charCount,
        limit: p.monthlyCharLimit,
        exhausted: record.charCount >= p.monthlyCharLimit
      }
    })
  }

  private getCurrentMonthKey(): string {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }

  private getQuotaRecord(providerId: string, currentMonth: string): QuotaRecord {
    const existing = this.quota[providerId]
    if (existing && existing.monthKey === currentMonth) {
      return existing
    }
    // Reset for new month
    const record: QuotaRecord = { monthKey: currentMonth, charCount: 0 }
    this.quota[providerId] = record
    return record
  }
}
