/**
 * Translation quality metrics for the conversational JA<->EN benchmark.
 *
 * Currently implements chrF (character n-gram F-score) as a lightweight
 * stand-in for COMET-22. chrF is well-defined, language-agnostic, and
 * correlates reasonably with human judgement at the sentence level.
 *
 * TODO(#706): Replace chrF with COMET-22 (Unbabel/wmt22-comet-da) once a
 * stable Node.js ONNX inference path is available. The official COMET-22
 * implementation is PyTorch-only today, and porting the ~600MB XLM-R
 * encoder to ONNX requires non-trivial work.
 */

export interface SentenceQualityScore {
  chrF: number
}

/** Default chrF parameters from sacreBLEU. */
const CHRF_N = 6 // max character n-gram order
const CHRF_BETA = 2 // recall is weighted beta^2 times more than precision

/**
 * Compute character n-grams for a given order.
 * Whitespace is preserved so that word boundaries influence the score.
 */
function charNgrams(text: string, n: number): Map<string, number> {
  const counts = new Map<string, number>()
  if (text.length < n) return counts
  // Use Array.from to correctly split surrogate pairs (CJK + emoji)
  const chars = Array.from(text)
  for (let i = 0; i <= chars.length - n; i++) {
    const gram = chars.slice(i, i + n).join('')
    counts.set(gram, (counts.get(gram) ?? 0) + 1)
  }
  return counts
}

/**
 * Compute F-beta score for a single n-gram order.
 * Returns 0 if either side has no n-grams of that order.
 */
function fBetaForOrder(
  hyp: Map<string, number>,
  ref: Map<string, number>,
  beta: number
): number {
  if (hyp.size === 0 || ref.size === 0) return 0

  let matches = 0
  let hypTotal = 0
  let refTotal = 0

  for (const [gram, hCount] of hyp) {
    hypTotal += hCount
    const rCount = ref.get(gram) ?? 0
    matches += Math.min(hCount, rCount)
  }
  for (const rCount of ref.values()) {
    refTotal += rCount
  }

  if (hypTotal === 0 || refTotal === 0 || matches === 0) return 0

  const precision = matches / hypTotal
  const recall = matches / refTotal
  const beta2 = beta * beta
  return ((1 + beta2) * precision * recall) / (beta2 * precision + recall)
}

/**
 * Compute chrF score for a single hypothesis against a reference.
 * Returns a value in [0, 100] for readability (sacreBLEU convention).
 */
export function chrF(hypothesis: string, reference: string, n = CHRF_N, beta = CHRF_BETA): number {
  if (!hypothesis.trim() || !reference.trim()) return 0

  const orders: number[] = []
  for (let order = 1; order <= n; order++) {
    const hyp = charNgrams(hypothesis, order)
    const ref = charNgrams(reference, order)
    orders.push(fBetaForOrder(hyp, ref, beta))
  }

  // Macro-average over orders that have at least one matching gram in ref
  const validOrders = orders.filter((_, i) => {
    const referenceNgrams = charNgrams(reference, i + 1)
    return referenceNgrams.size > 0
  })
  if (validOrders.length === 0) return 0

  const avg = validOrders.reduce((acc, v) => acc + v, 0) / validOrders.length
  return avg * 100
}

/** Score a single hypothesis. */
export function scoreSentence(hypothesis: string, reference: string): SentenceQualityScore {
  return { chrF: chrF(hypothesis, reference) }
}

/** Latency percentile helper. */
export function percentile(sortedValues: number[], p: number): number {
  if (sortedValues.length === 0) return 0
  const idx = Math.min(
    Math.max(Math.ceil((p / 100) * sortedValues.length) - 1, 0),
    sortedValues.length - 1
  )
  return sortedValues[idx]!
}
