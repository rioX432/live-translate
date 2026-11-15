// Pure-logic helpers for the Onboarding flow.
// Kept React/DOM-free so they can be unit-tested under the
// `node` Vitest environment configured in vitest.config.ts.

/** The onboarding steps shown to the user. */
export type OnboardingStep = 'download' | 'done'

/**
 * Download status string from the main process (onboarding-downloader.ts). Main downloads
 * one model set per platform, so only 'downloading-tier1' and 'all-ready' occur in practice;
 * the tier names are kept because they are the IPC contract.
 */
export type DownloadStatus =
  | 'idle'
  | 'downloading-tier1'
  | 'tier1-ready'
  | 'downloading-tier2'
  | 'all-ready'
  | 'failed'

export function isDownloading(status: DownloadStatus): boolean {
  return status === 'downloading-tier1' || status === 'downloading-tier2'
}

/** Compute the next step when the user clicks "Finish" / "Skip". */
export function nextStep(_current: OnboardingStep): OnboardingStep {
  return 'done'
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
