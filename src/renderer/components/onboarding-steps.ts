// Pure-logic helpers for the Onboarding 3-step flow.
// Kept React/DOM-free so they can be unit-tested under the
// `node` Vitest environment configured in vitest.config.ts.

/** The onboarding steps shown to the user. */
export type OnboardingStep = 'quick-start' | 'quality-upgrade' | 'done'

/** Step 1 totals: Whisper Base (142MB) + LFM2 350M Q4_K_M (~229MB) ≈ 371MB. */
export const TIER1_TOTAL_MB = 371

/** Step 2 totals: Kotoba Whisper v2.0 (~540MB) + HY-MT1.5 1.8B Q4_K_M (~1.1GB) ≈ 1.6GB. */
export const TIER2_TOTAL_MB = 1640

/** Tier-aware download status string from the main process (onboarding-downloader.ts). */
export type DownloadStatus =
  | 'idle'
  | 'downloading-tier1'
  | 'tier1-ready'
  | 'downloading-tier2'
  | 'all-ready'
  | 'failed'

export interface StepDecisionInput {
  tier1Ready: boolean
  tier2Ready: boolean
  status: DownloadStatus
}

/**
 * Pick the initial step on mount based on persisted download state.
 *
 * Rules:
 *  - Neither tier ready → start at Quick Start (Step 1)
 *  - Only Tier 1 ready → start at Quality Upgrade (Step 2) — let user see the
 *    background download or skip ahead
 *  - Both tiers ready → also Quality Upgrade, which shows the ready state
 */
export function pickInitialStep(input: StepDecisionInput): OnboardingStep {
  if (input.tier1Ready && input.tier2Ready) return 'quality-upgrade'
  if (input.tier1Ready) return 'quality-upgrade'
  return 'quick-start'
}

/** Compute the next step when the user clicks "Next" / "Skip" on a given step. */
export function nextStep(current: OnboardingStep): OnboardingStep {
  switch (current) {
    case 'quick-start':
      return 'quality-upgrade'
    case 'quality-upgrade':
    case 'done':
      return 'done'
  }
}

/** Format an MB count for user-visible labels (e.g. 371MB, 1.6GB). */
export function formatSize(mb: number): string {
  if (mb >= 1024) {
    const gb = mb / 1024
    // 1 decimal place when value is not an integer GB
    return `${gb.toFixed(gb >= 10 ? 0 : 1)}GB`
  }
  return `${Math.round(mb)}MB`
}
