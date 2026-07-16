/**
 * Multivariate telemetry aggregation for the shadow measurement harness (#720).
 *
 * Runtime telemetry deliberately covers only what is measurable WITHOUT a
 * reference translation: latency, first-subtitle latency, cost (BYOK metered),
 * privacy (offline completeness), drop/error rates, and a revision-count
 * stability proxy. Reference-based quality (chrF/COMET) is computed offline in
 * the benchmark extension, never at runtime.
 */

import type {
  ShadowCostModel,
  ShadowSample,
  ShadowDrop,
  ShadowError,
  ShadowPathDescriptor,
  ShadowPathKind
} from './types'

/** Nearest-rank percentile of an already-sorted ascending array. */
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  const idx = Math.min(
    Math.max(Math.ceil((p / 100) * sortedValues.length) - 1, 0),
    sortedValues.length - 1
  )
  return sortedValues[idx]!
}

function mean(values: number[]): number {
  if (values.length === 0) return 0
  return values.reduce((a, b) => a + b, 0) / values.length
}

/** Latency distribution summary (ms). */
export interface LatencyStats {
  p50: number
  p95: number
  mean: number
}

/** Per-path multivariate summary. */
export interface PathSummary {
  pathId: string
  kind: ShadowPathKind
  usesLocalLlm: boolean
  isOffline: boolean
  /** Number of measured samples. */
  processedCount: number
  /** Total dropped segments across all reasons (busy / sampling / disabled). */
  droppedCount: number
  /** Segments dropped because the path (or the global local-LLM permit) was busy. */
  busyDroppedCount: number
  /** Number of processing errors. */
  errorCount: number
  /**
   * busyDropped / (processed + busyDropped). Deliberately excludes sampling and
   * disabled drops (those are policy, not saturation) — a fast-looking path
   * that busy-dropped most of its work is not actually fast.
   */
  busyDropRate: number
  /** errors / (processed + errors). */
  errorRate: number
  /** End-to-end latency distribution. */
  latency: LatencyStats
  /** First-subtitle latency distribution, or null when no sample emitted an interim. */
  firstSubtitle: LatencyStats | null
  /** Mean interim revisions per sample (STABILITY proxy, not quality). */
  meanRevisionCount: number
  /** Total BYOK-metered cost across samples (USD). */
  totalCostUsd: number
  /** Fraction of samples that stayed fully offline (privacy: offline completeness). */
  offlineCompleteness: number
}

/** Full multivariate telemetry report emitted by the runner. */
export interface ShadowReport {
  generatedAt: number
  totalSegments: number
  paths: PathSummary[]
}

function latencyStats(values: number[]): LatencyStats {
  const sorted = [...values].sort((a, b) => a - b)
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    mean: mean(values)
  }
}

/**
 * Aggregate raw records into a per-path multivariate report. Pure function —
 * takes the records and the set of registered path descriptors so paths with
 * zero samples still appear (a path that dropped everything is meaningful).
 */
export function summarize(
  descriptors: ShadowPathDescriptor[],
  samples: readonly ShadowSample[],
  drops: readonly ShadowDrop[],
  errors: readonly ShadowError[],
  totalSegments: number
): ShadowReport {
  const paths: PathSummary[] = descriptors.map((d) => {
    const pathSamples = samples.filter((s) => s.pathId === d.id)
    const pathDrops = drops.filter((x) => x.pathId === d.id)
    const droppedCount = pathDrops.length
    const busyDroppedCount = pathDrops.filter(
      (x) => x.reason === 'path-busy' || x.reason === 'local-llm-busy'
    ).length
    const errorCount = errors.filter((x) => x.pathId === d.id).length
    const processedCount = pathSamples.length

    const latencies = pathSamples.map((s) => s.latencyMs)
    const firstSubs = pathSamples
      .map((s) => s.firstSubtitleMs)
      .filter((v): v is number => v !== null)
    const offlineSamples = pathSamples.filter((s) => s.isOffline).length

    const processedPlusBusyDropped = processedCount + busyDroppedCount
    const processedPlusErrors = processedCount + errorCount

    return {
      pathId: d.id,
      kind: d.kind,
      usesLocalLlm: d.usesLocalLlm,
      isOffline: d.isOffline,
      processedCount,
      droppedCount,
      busyDroppedCount,
      errorCount,
      busyDropRate: processedPlusBusyDropped === 0 ? 0 : busyDroppedCount / processedPlusBusyDropped,
      errorRate: processedPlusErrors === 0 ? 0 : errorCount / processedPlusErrors,
      latency: latencyStats(latencies),
      firstSubtitle: firstSubs.length === 0 ? null : latencyStats(firstSubs),
      meanRevisionCount: mean(pathSamples.map((s) => s.revisionCount)),
      totalCostUsd: pathSamples.reduce((sum, s) => sum + s.costUsd, 0),
      offlineCompleteness: processedCount === 0 ? (d.isOffline ? 1 : 0) : offlineSamples / processedCount
    }
  })

  return {
    generatedAt: Date.now(),
    totalSegments,
    paths
  }
}

/** Billable quantities of one measured sample. */
export interface CostBasis {
  /** Source character count (drives text-metered pricing). */
  sourceChars: number
  /** Source audio duration in ms (drives speech-metered pricing). */
  audioDurationMs: number
  cost: ShadowCostModel
}

/**
 * Estimate BYOK-metered cost in USD for one sample. Dimensions are summed: a path
 * metered on both characters and audio minutes pays both. Non-finite or negative
 * quantities contribute zero rather than poisoning the total with NaN.
 */
export function estimateCostUsd({ sourceChars, audioDurationMs, cost }: CostBasis): number {
  const perChar = component(sourceChars, cost.usdPerMillionChars, 1_000_000)
  const perMinute = component(audioDurationMs, cost.usdPerAudioMinute, 60_000)
  return perChar + perMinute
}

/** One additive cost dimension: `quantity / unitSize * usdPerUnit`, guarded. */
function component(quantity: number, usdPerUnit: number | undefined, unitSize: number): number {
  if (usdPerUnit === undefined) return 0
  if (!Number.isFinite(quantity) || !Number.isFinite(usdPerUnit)) return 0
  if (quantity <= 0 || usdPerUnit <= 0) return 0
  return (quantity / unitSize) * usdPerUnit
}
