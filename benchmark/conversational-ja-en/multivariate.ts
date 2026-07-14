/**
 * Multivariate evaluation for the conversational JA<->EN benchmark (#720).
 *
 * Extends the chrF-only quality metric (#706) into the five axes the shadow
 * measurement plan calls for, so engine paths are compared on more than a
 * single variable:
 *
 *   quality  — chrF (reference-based) + proper-noun breakage
 *   latency  — p50 / p95 wall-clock per path
 *   cost     — BYOK metered USD (source chars * rate; 0 for offline paths)
 *   privacy  — offline completeness (fully offline == 1)
 *   value    — glossary applicability / arbitrary output surface
 *
 * It also encodes the decision rule from the issue: when quality is within a
 * small delta, prefer cost / privacy / value and keep the switchable hybrid as
 * the default (rather than becoming a degraded copy of Apple/Google).
 */

import { chrF, percentile } from './metrics'

/** Reference-based quality signals for one path. */
export interface QualitySignals {
  /** Mean chrF over all sentences (0-100). */
  meanChrF: number
  /** Fraction of expected proper nouns missing from the output (0-1, lower is better). */
  properNounBreakage: number
}

/** A single translated sentence paired with its reference. */
export interface ScoredSentence {
  hypothesis: string
  reference: string
  /** Proper nouns expected to survive translation (checked for breakage). */
  properNouns?: string[]
}

/** Input describing one measurable path for multivariate scoring. */
export interface MultivariatePathInput {
  pathId: string
  label: string
  /** True if the path completes fully offline. */
  isOffline: boolean
  /** BYOK cost rate; 0 for offline paths. */
  usdPerMillionChars: number
  /** Per-sentence outputs with references. */
  sentences: ScoredSentence[]
  /** Wall-clock latency per sentence (ms). */
  latenciesMs: number[]
  /** Total source characters processed (for cost metering). */
  sourceCharsTotal: number
  /** Whether the path can honor a user glossary (user-value axis). */
  supportsGlossary: boolean
  /** Whether the path exposes an arbitrary output surface (user-value axis). */
  supportsArbitrarySurface: boolean
}

/** Per-path multivariate report. */
export interface MultivariatePathReport {
  pathId: string
  label: string
  quality: QualitySignals
  latency: { p50: number; p95: number }
  cost: { totalUsd: number; usdPerMillionChars: number }
  privacy: { offlineCompleteness: number }
  value: { supportsGlossary: boolean; supportsArbitrarySurface: boolean }
}

/**
 * Fraction of expected proper nouns absent from the hypothesis. Proper-noun
 * breakage is a common failure of aggressive MT on meeting speech (names,
 * product/library names), so it is tracked separately from chrF.
 */
export function properNounBreakage(hypothesis: string, properNouns: string[]): number {
  if (properNouns.length === 0) return 0
  const hay = hypothesis.toLowerCase()
  let missing = 0
  for (const noun of properNouns) {
    if (!hay.includes(noun.toLowerCase())) missing++
  }
  return missing / properNouns.length
}

/** Compute the quality signals for a set of scored sentences. */
export function scoreQuality(sentences: ScoredSentence[]): QualitySignals {
  if (sentences.length === 0) return { meanChrF: 0, properNounBreakage: 0 }

  let chrfSum = 0
  let breakageSum = 0
  let breakageDenom = 0
  for (const s of sentences) {
    chrfSum += chrF(s.hypothesis, s.reference)
    if (s.properNouns && s.properNouns.length > 0) {
      breakageSum += properNounBreakage(s.hypothesis, s.properNouns)
      breakageDenom++
    }
  }
  return {
    meanChrF: chrfSum / sentences.length,
    properNounBreakage: breakageDenom === 0 ? 0 : breakageSum / breakageDenom
  }
}

/** Build a per-path multivariate report from raw path inputs. */
export function buildPathReport(input: MultivariatePathInput): MultivariatePathReport {
  const sorted = [...input.latenciesMs].sort((a, b) => a - b)
  const totalUsd =
    input.usdPerMillionChars <= 0 || input.sourceCharsTotal <= 0
      ? 0
      : (input.sourceCharsTotal / 1_000_000) * input.usdPerMillionChars
  return {
    pathId: input.pathId,
    label: input.label,
    quality: scoreQuality(input.sentences),
    latency: { p50: percentile(sorted, 50), p95: percentile(sorted, 95) },
    cost: { totalUsd, usdPerMillionChars: input.usdPerMillionChars },
    privacy: { offlineCompleteness: input.isOffline ? 1 : 0 },
    value: {
      supportsGlossary: input.supportsGlossary,
      supportsArbitrarySurface: input.supportsArbitrarySurface
    }
  }
}

/** Recommendation output of {@link recommendDefault}. */
export interface DefaultRecommendation {
  /** Chosen default path id, or null when there are no paths. */
  pathId: string | null
  /** Human-readable rationale referencing the decision rule. */
  rationale: string
  /** Paths that tied on quality (within the delta) and competed on cost/privacy/value. */
  qualityTiedPathIds: string[]
}

/** chrF points within which two paths are treated as a quality tie. */
export const DEFAULT_QUALITY_TIE_DELTA = 2

/**
 * Decision rule (issue #720): when quality is within `qualityTieDelta` chrF
 * points of the best path, prefer cost / privacy / value and keep the
 * switchable hybrid default. Concretely, among the quality-tied paths we prefer
 * (in order): lower proper-noun breakage, offline (privacy), lower cost, then
 * glossary support.
 */
export function recommendDefault(
  reports: MultivariatePathReport[],
  qualityTieDelta = DEFAULT_QUALITY_TIE_DELTA
): DefaultRecommendation {
  if (reports.length === 0) {
    return { pathId: null, rationale: 'No paths to evaluate.', qualityTiedPathIds: [] }
  }

  const bestChrF = Math.max(...reports.map((r) => r.quality.meanChrF))
  const tied = reports.filter((r) => bestChrF - r.quality.meanChrF <= qualityTieDelta)

  const ranked = [...tied].sort((a, b) => {
    if (a.quality.properNounBreakage !== b.quality.properNounBreakage) {
      return a.quality.properNounBreakage - b.quality.properNounBreakage
    }
    if (a.privacy.offlineCompleteness !== b.privacy.offlineCompleteness) {
      return b.privacy.offlineCompleteness - a.privacy.offlineCompleteness
    }
    if (a.cost.totalUsd !== b.cost.totalUsd) {
      return a.cost.totalUsd - b.cost.totalUsd
    }
    return Number(b.value.supportsGlossary) - Number(a.value.supportsGlossary)
  })

  const winner = ranked[0]!
  const rationale =
    tied.length === 1
      ? `${winner.label} leads on quality (chrF ${winner.quality.meanChrF.toFixed(1)}).`
      : `Quality tie within ${qualityTieDelta} chrF; tie broken by proper-noun breakage, ` +
        `then privacy/cost/value — keeping the switchable hybrid default. Chose ${winner.label} ` +
        `(offline=${winner.privacy.offlineCompleteness === 1}, cost=$${winner.cost.totalUsd.toFixed(4)}, ` +
        `proper-noun breakage=${winner.quality.properNounBreakage.toFixed(2)}).`

  return {
    pathId: winner.pathId,
    rationale,
    qualityTiedPathIds: tied.map((r) => r.pathId)
  }
}

/** Full multivariate report across all paths plus the default recommendation. */
export interface MultivariateReport {
  generatedAt: string
  paths: MultivariatePathReport[]
  recommendation: DefaultRecommendation
}

/** Build the full multivariate report for a set of paths. */
export function buildMultivariateReport(
  inputs: MultivariatePathInput[],
  qualityTieDelta = DEFAULT_QUALITY_TIE_DELTA
): MultivariateReport {
  const paths = inputs.map(buildPathReport)
  return {
    generatedAt: new Date().toISOString(),
    paths,
    recommendation: recommendDefault(paths, qualityTieDelta)
  }
}
