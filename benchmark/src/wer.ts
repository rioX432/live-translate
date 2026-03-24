import type { WERResult } from './stt-types.js'

/**
 * Compute Word Error Rate using Levenshtein distance.
 * For Japanese: character-level (split by char).
 * For English: word-level (split by whitespace).
 */
export function computeWER(reference: string, hypothesis: string, language: string): WERResult {
  const refTokens = tokenize(reference, language)
  const hypTokens = tokenize(hypothesis, language)

  if (refTokens.length === 0) {
    return {
      wer: hypTokens.length > 0 ? 1 : 0,
      substitutions: 0,
      insertions: hypTokens.length,
      deletions: 0,
      referenceLength: 0
    }
  }

  const { substitutions, insertions, deletions } = editDistance(refTokens, hypTokens)
  const wer = (substitutions + insertions + deletions) / refTokens.length

  return { wer, substitutions, insertions, deletions, referenceLength: refTokens.length }
}

/**
 * Aggregate WER from multiple results.
 * Micro-average: sum of all errors / sum of all reference lengths.
 */
export function aggregateWER(results: WERResult[]): WERResult {
  if (results.length === 0) {
    return { wer: 0, substitutions: 0, insertions: 0, deletions: 0, referenceLength: 0 }
  }

  let totalSub = 0
  let totalIns = 0
  let totalDel = 0
  let totalRef = 0

  for (const r of results) {
    totalSub += r.substitutions
    totalIns += r.insertions
    totalDel += r.deletions
    totalRef += r.referenceLength
  }

  return {
    wer: totalRef > 0 ? (totalSub + totalIns + totalDel) / totalRef : 0,
    substitutions: totalSub,
    insertions: totalIns,
    deletions: totalDel,
    referenceLength: totalRef
  }
}

/** Tokenize text based on language */
function tokenize(text: string, language: string): string[] {
  const normalized = text.trim().toLowerCase()
  if (!normalized) return []

  if (language === 'ja') {
    // Character-level for Japanese (remove spaces and punctuation)
    return [...normalized.replace(/[\s\u3000。、！？「」（）・…]/g, '')]
  }

  // Word-level for English and other languages
  return normalized
    .replace(/[.,!?;:'"()\-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0)
}

/** Compute edit distance and return S/I/D counts */
function editDistance(ref: string[], hyp: string[]): {
  substitutions: number
  insertions: number
  deletions: number
} {
  const n = ref.length
  const m = hyp.length

  // dp[i][j] = { cost, sub, ins, del }
  const dp: Array<Array<{ cost: number; sub: number; ins: number; del: number }>> = []

  for (let i = 0; i <= n; i++) {
    dp[i] = []
    for (let j = 0; j <= m; j++) {
      dp[i]![j] = { cost: 0, sub: 0, ins: 0, del: 0 }
    }
  }

  // Base cases
  for (let i = 1; i <= n; i++) {
    dp[i]![0] = { cost: i, sub: 0, ins: 0, del: i }
  }
  for (let j = 1; j <= m; j++) {
    dp[0]![j] = { cost: j, sub: 0, ins: j, del: 0 }
  }

  // Fill DP table
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const subCost = ref[i - 1] === hyp[j - 1] ? 0 : 1
      const sub = dp[i - 1]![j - 1]!.cost + subCost
      const del = dp[i - 1]![j]!.cost + 1
      const ins = dp[i]![j - 1]!.cost + 1

      if (sub <= del && sub <= ins) {
        const prev = dp[i - 1]![j - 1]!
        dp[i]![j] = {
          cost: sub,
          sub: prev.sub + subCost,
          ins: prev.ins,
          del: prev.del
        }
      } else if (del <= ins) {
        const prev = dp[i - 1]![j]!
        dp[i]![j] = {
          cost: del,
          sub: prev.sub,
          ins: prev.ins,
          del: prev.del + 1
        }
      } else {
        const prev = dp[i]![j - 1]!
        dp[i]![j] = {
          cost: ins,
          sub: prev.sub,
          ins: prev.ins + 1,
          del: prev.del
        }
      }
    }
  }

  const result = dp[n]![m]!
  return {
    substitutions: result.sub,
    insertions: result.ins,
    deletions: result.del
  }
}
