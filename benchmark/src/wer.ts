import type { AccuracyStats, STTLanguage } from './stt-types.js'

/**
 * Tokenize text for error rate calculation.
 * - Japanese: character-level (CER) — split into individual characters, ignoring whitespace
 * - English: word-level (WER) — split on whitespace, lowercased
 */
function tokenize(text: string, language: STTLanguage): string[] {
  const normalized = text.trim()
  if (!normalized) return []

  if (language === 'ja') {
    // Character-level: remove all whitespace, split into chars
    return normalized.replace(/\s+/g, '').split('')
  }

  // Word-level: lowercase and split on whitespace
  return normalized
    .toLowerCase()
    .replace(/[^\w\s]/g, '') // remove punctuation
    .split(/\s+/)
    .filter((w) => w.length > 0)
}

/**
 * Compute the minimum edit distance (Levenshtein) between reference and hypothesis tokens.
 * Returns substitutions, deletions, insertions, and total distance.
 */
function editDistance(ref: string[], hyp: string[]): {
  distance: number
  substitutions: number
  deletions: number
  insertions: number
} {
  const n = ref.length
  const m = hyp.length

  // dp[i][j] = { cost, sub, del, ins }
  const dp: Array<Array<{ cost: number; sub: number; del: number; ins: number }>> = []

  for (let i = 0; i <= n; i++) {
    dp[i] = []
    for (let j = 0; j <= m; j++) {
      dp[i]![j] = { cost: 0, sub: 0, del: 0, ins: 0 }
    }
  }

  // Base cases
  for (let i = 1; i <= n; i++) {
    dp[i]![0] = { cost: i, sub: 0, del: i, ins: 0 }
  }
  for (let j = 1; j <= m; j++) {
    dp[0]![j] = { cost: j, sub: 0, del: 0, ins: j }
  }

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (ref[i - 1] === hyp[j - 1]) {
        // Match — no cost
        dp[i]![j] = { ...dp[i - 1]![j - 1]! }
      } else {
        const subCost = dp[i - 1]![j - 1]!.cost + 1
        const delCost = dp[i - 1]![j]!.cost + 1
        const insCost = dp[i]![j - 1]!.cost + 1

        if (subCost <= delCost && subCost <= insCost) {
          const prev = dp[i - 1]![j - 1]!
          dp[i]![j] = {
            cost: subCost,
            sub: prev.sub + 1,
            del: prev.del,
            ins: prev.ins
          }
        } else if (delCost <= insCost) {
          const prev = dp[i - 1]![j]!
          dp[i]![j] = {
            cost: delCost,
            sub: prev.sub,
            del: prev.del + 1,
            ins: prev.ins
          }
        } else {
          const prev = dp[i]![j - 1]!
          dp[i]![j] = {
            cost: insCost,
            sub: prev.sub,
            del: prev.del,
            ins: prev.ins + 1
          }
        }
      }
    }
  }

  const result = dp[n]![m]!
  return {
    distance: result.cost,
    substitutions: result.sub,
    deletions: result.del,
    insertions: result.ins
  }
}

/**
 * Compute accuracy stats for a single reference/hypothesis pair.
 * Uses CER for Japanese, WER for English.
 */
export function computeErrorRate(
  reference: string,
  hypothesis: string,
  language: STTLanguage
): AccuracyStats {
  const refTokens = tokenize(reference, language)
  const hypTokens = tokenize(hypothesis, language)

  if (refTokens.length === 0) {
    return {
      errorRate: hypTokens.length > 0 ? 1.0 : 0.0,
      substitutions: 0,
      deletions: 0,
      insertions: hypTokens.length,
      totalReferenceTokens: 0
    }
  }

  const { substitutions, deletions, insertions } = editDistance(refTokens, hypTokens)
  const totalErrors = substitutions + deletions + insertions
  const errorRate = totalErrors / refTokens.length

  return {
    errorRate,
    substitutions,
    deletions,
    insertions,
    totalReferenceTokens: refTokens.length
  }
}

/**
 * Aggregate accuracy stats from multiple results.
 * Computes corpus-level error rate (sum of errors / sum of reference tokens).
 */
export function aggregateAccuracy(stats: AccuracyStats[]): AccuracyStats {
  if (stats.length === 0) {
    return {
      errorRate: 0,
      substitutions: 0,
      deletions: 0,
      insertions: 0,
      totalReferenceTokens: 0
    }
  }

  const total = stats.reduce(
    (acc, s) => ({
      substitutions: acc.substitutions + s.substitutions,
      deletions: acc.deletions + s.deletions,
      insertions: acc.insertions + s.insertions,
      totalReferenceTokens: acc.totalReferenceTokens + s.totalReferenceTokens
    }),
    { substitutions: 0, deletions: 0, insertions: 0, totalReferenceTokens: 0 }
  )

  const totalErrors = total.substitutions + total.deletions + total.insertions
  const errorRate = total.totalReferenceTokens > 0 ? totalErrors / total.totalReferenceTokens : 0

  return {
    errorRate,
    ...total
  }
}
