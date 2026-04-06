import type { TranslatorEngine, Language, TranslateContext, GlossaryEntry } from '../engines/types'
import { createLogger } from '../main/logger'

const log = createLogger('pipeline:router')

/** Routing decision tier */
export type RoutingTier = 'fast' | 'quality'

/** Configuration for adaptive routing thresholds */
export interface AdaptiveRoutingConfig {
  /** Enable adaptive routing between fast and quality engines */
  enabled: boolean
  /** Token count threshold: below this → fast only (default 10) */
  shortThreshold: number
  /** Token count threshold: above this → quality (default 50) */
  longThreshold: number
  /** Vocabulary rarity weight in complexity score (0.0-1.0, default 0.3) */
  rarityWeight: number
  /** Glossary match weight in complexity score (0.0-1.0, default 0.2) */
  glossaryWeight: number
}

export const DEFAULT_ROUTING_CONFIG: AdaptiveRoutingConfig = {
  enabled: false,
  shortThreshold: 10,
  longThreshold: 50,
  rarityWeight: 0.3,
  glossaryWeight: 0.2
}

/** Result of a complexity analysis */
export interface ComplexityScore {
  /** Total complexity score (0.0-1.0) */
  score: number
  /** Approximate token count */
  tokenCount: number
  /** Vocabulary rarity score (0.0-1.0) */
  rarityScore: number
  /** Whether glossary terms were found in the text */
  hasGlossaryTerms: boolean
  /** Decided routing tier */
  tier: RoutingTier
}

/** Telemetry record for a routing decision */
export interface RoutingTelemetry {
  timestamp: number
  sourceText: string
  tier: RoutingTier
  complexity: ComplexityScore
  latencyMs: number
  engineId: string
}

/**
 * Common words that indicate low vocabulary rarity.
 * Used as a baseline — sentences using mostly these words are considered simple.
 * Covers English and Japanese basic particles/words.
 */
const COMMON_EN_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'must', 'need', 'dare',
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her',
  'us', 'them', 'my', 'your', 'his', 'its', 'our', 'their',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
  'and', 'or', 'but', 'not', 'no', 'yes', 'if', 'then', 'so', 'too',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by', 'up',
  'about', 'into', 'through', 'after', 'before', 'between', 'under',
  'very', 'just', 'also', 'now', 'here', 'there', 'when', 'where',
  'how', 'all', 'each', 'every', 'both', 'few', 'more', 'some', 'any',
  'other', 'than', 'only', 'own', 'same', 'new', 'old', 'good', 'bad',
  'like', 'know', 'think', 'want', 'get', 'go', 'come', 'make', 'take',
  'see', 'say', 'tell', 'give', 'find', 'look', 'use', 'try', 'let',
  'still', 'well', 'back', 'even', 'way', 'time', 'day', 'year',
  'right', 'much', 'many', 'please', 'thank', 'thanks', 'okay', 'ok',
  'hello', 'hi', 'bye', 'yes', 'no', 'yeah', 'sure', 'sorry'
])

/**
 * Adaptive quality router for translation engines.
 *
 * Scores input complexity and routes to either a fast engine (e.g. HY-MT1.5-1.8B)
 * or a quality engine (e.g. Hunyuan-MT 7B) based on configurable thresholds.
 *
 * Complexity factors:
 * 1. Token count (primary signal)
 * 2. Vocabulary rarity (proportion of uncommon words)
 * 3. Glossary term presence (important terms need quality translation)
 */
export class AdaptiveRouter {
  private config: AdaptiveRoutingConfig
  private fastEngine: TranslatorEngine | null = null
  private qualityEngine: TranslatorEngine | null = null
  private glossary: GlossaryEntry[] = []
  private telemetryLog: RoutingTelemetry[] = []
  private maxTelemetryEntries = 1000

  constructor(config?: Partial<AdaptiveRoutingConfig>) {
    this.config = { ...DEFAULT_ROUTING_CONFIG, ...config }
  }

  /** Update routing configuration */
  setConfig(config: Partial<AdaptiveRoutingConfig>): void {
    this.config = { ...this.config, ...config }
    log.info('Routing config updated:', JSON.stringify(this.config))
  }

  /** Get current configuration */
  getConfig(): Readonly<AdaptiveRoutingConfig> {
    return { ...this.config }
  }

  /** Set the fast (small/lightweight) translation engine */
  setFastEngine(engine: TranslatorEngine | null): void {
    this.fastEngine = engine
  }

  /** Set the quality (large/heavyweight) translation engine */
  setQualityEngine(engine: TranslatorEngine | null): void {
    this.qualityEngine = engine
  }

  /** Update glossary terms for complexity scoring */
  setGlossary(glossary: GlossaryEntry[]): void {
    this.glossary = glossary
  }

  /** Whether the router has both engines available */
  get isReady(): boolean {
    return this.fastEngine !== null && this.qualityEngine !== null
  }

  /**
   * Tokenize text into approximate tokens.
   * Uses whitespace splitting for Latin scripts and character-level for CJK.
   */
  static tokenize(text: string): string[] {
    const tokens: string[] = []
    // Split on whitespace first
    const parts = text.trim().split(/\s+/)
    for (const part of parts) {
      if (!part) continue
      // Check if the part contains CJK characters
      if (/[\u3000-\u9fff\uf900-\ufaff]/.test(part)) {
        // CJK: each character is approximately one token
        for (const char of part) {
          if (/[\u3000-\u9fff\uf900-\ufaff]/.test(char)) {
            tokens.push(char)
          } else if (char.trim()) {
            tokens.push(char)
          }
        }
      } else {
        tokens.push(part.toLowerCase())
      }
    }
    return tokens
  }

  /**
   * Calculate vocabulary rarity score (0.0-1.0).
   * Higher score means more rare/uncommon words.
   */
  static calculateRarityScore(tokens: string[]): number {
    if (tokens.length === 0) return 0
    let uncommonCount = 0
    for (const token of tokens) {
      // Skip punctuation-only tokens
      if (/^[^\w\u3000-\u9fff]+$/u.test(token)) continue
      // CJK tokens are always considered "common" for rarity purposes
      // (since we can't easily assess rarity without a frequency dictionary)
      if (/[\u3000-\u9fff]/.test(token)) continue
      const normalized = token.toLowerCase().replace(/[^a-z]/g, '')
      if (normalized.length > 0 && !COMMON_EN_WORDS.has(normalized)) {
        uncommonCount++
      }
    }
    const wordTokens = tokens.filter((t) => /[\w\u3000-\u9fff]/u.test(t))
    if (wordTokens.length === 0) return 0
    return Math.min(1, uncommonCount / wordTokens.length)
  }

  /**
   * Check if text contains any glossary terms.
   */
  hasGlossaryMatch(text: string): boolean {
    if (this.glossary.length === 0) return false
    const lower = text.toLowerCase()
    return this.glossary.some((entry) => lower.includes(entry.source.toLowerCase()))
  }

  /**
   * Score the complexity of input text.
   */
  scoreComplexity(text: string): ComplexityScore {
    const tokens = AdaptiveRouter.tokenize(text)
    const tokenCount = tokens.length
    const rarityScore = AdaptiveRouter.calculateRarityScore(tokens)
    const hasGlossaryTerms = this.hasGlossaryMatch(text)

    // Normalize token count to 0-1 range using thresholds
    const tokenNorm = Math.min(1, tokenCount / Math.max(1, this.config.longThreshold))

    // Weighted composite score
    const lengthWeight = 1 - this.config.rarityWeight - this.config.glossaryWeight
    const glossaryBoost = hasGlossaryTerms ? 1 : 0
    const score = Math.min(
      1,
      tokenNorm * lengthWeight + rarityScore * this.config.rarityWeight + glossaryBoost * this.config.glossaryWeight
    )

    // Determine tier based on thresholds
    let tier: RoutingTier
    if (tokenCount < this.config.shortThreshold) {
      // Short sentences always go fast regardless of complexity
      tier = 'fast'
    } else if (tokenCount >= this.config.longThreshold) {
      // Long sentences always go quality
      tier = 'quality'
    } else {
      // Medium range: decide by composite score (threshold at 0.5)
      tier = score >= 0.5 ? 'quality' : 'fast'
    }

    return { score, tokenCount, rarityScore, hasGlossaryTerms, tier }
  }

  /**
   * Route a translation request to the appropriate engine.
   * Falls back to fast engine if quality engine is not available,
   * or to quality engine if fast engine is not available.
   */
  async translate(
    text: string,
    from: Language,
    to: Language,
    context?: TranslateContext
  ): Promise<{ translated: string; complexity: ComplexityScore; engineId: string; latencyMs: number }> {
    const complexity = this.scoreComplexity(text)
    const engine = this.selectEngine(complexity.tier)

    if (!engine) {
      throw new Error('No translation engine available for adaptive routing')
    }

    const engineId = engine.id
    const t0 = performance.now()
    const translated = await engine.translate(text, from, to, context)
    const latencyMs = performance.now() - t0

    // Record telemetry
    this.recordTelemetry({
      timestamp: Date.now(),
      sourceText: text.substring(0, 100), // Truncate for privacy
      tier: complexity.tier,
      complexity,
      latencyMs,
      engineId
    })

    log.info(
      `Route: "${text.substring(0, 40)}..." → ${complexity.tier} (${engineId}) ` +
      `[tokens=${complexity.tokenCount}, rarity=${complexity.rarityScore.toFixed(2)}, ` +
      `glossary=${complexity.hasGlossaryTerms}, score=${complexity.score.toFixed(2)}, ` +
      `latency=${latencyMs.toFixed(0)}ms]`
    )

    return { translated, complexity, engineId, latencyMs }
  }

  /** Select engine based on routing tier with fallback */
  private selectEngine(tier: RoutingTier): TranslatorEngine | null {
    if (tier === 'quality') {
      return this.qualityEngine ?? this.fastEngine
    }
    return this.fastEngine ?? this.qualityEngine
  }

  /** Record a telemetry entry, evicting oldest if over limit */
  private recordTelemetry(entry: RoutingTelemetry): void {
    this.telemetryLog.push(entry)
    if (this.telemetryLog.length > this.maxTelemetryEntries) {
      this.telemetryLog.shift()
    }
  }

  /** Get telemetry log for analytics */
  getTelemetry(): ReadonlyArray<RoutingTelemetry> {
    return this.telemetryLog
  }

  /** Get telemetry summary statistics */
  getTelemetrySummary(): {
    totalRequests: number
    fastCount: number
    qualityCount: number
    avgFastLatencyMs: number
    avgQualityLatencyMs: number
  } {
    const fast = this.telemetryLog.filter((t) => t.tier === 'fast')
    const quality = this.telemetryLog.filter((t) => t.tier === 'quality')
    return {
      totalRequests: this.telemetryLog.length,
      fastCount: fast.length,
      qualityCount: quality.length,
      avgFastLatencyMs: fast.length > 0
        ? fast.reduce((sum, t) => sum + t.latencyMs, 0) / fast.length
        : 0,
      avgQualityLatencyMs: quality.length > 0
        ? quality.reduce((sum, t) => sum + t.latencyMs, 0) / quality.length
        : 0
    }
  }

  /** Clear telemetry log */
  clearTelemetry(): void {
    this.telemetryLog = []
  }

  /** Dispose engines managed by this router */
  async dispose(): Promise<void> {
    // Do not dispose engines here — EngineManager owns their lifecycle.
    // Just clear references.
    this.fastEngine = null
    this.qualityEngine = null
    this.glossary = []
    this.telemetryLog = []
  }
}
