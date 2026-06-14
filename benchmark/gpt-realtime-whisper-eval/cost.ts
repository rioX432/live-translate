/**
 * Cost projection utilities for GPT-Realtime-Whisper.
 *
 * OpenAI prices gpt-realtime-whisper at USD 0.017 per minute of audio
 * duration (announced 2026-05-07, source: developers.openai.com docs).
 * That is per-minute billing of duration sent to the API, independent of
 * latency tier or transcript length.
 */

export const GPT_REALTIME_WHISPER_USD_PER_MINUTE = 0.017

/**
 * Projected monthly USD cost for a target daily usage pattern.
 *
 * @param hoursPerDay Average hours of speech transcribed per day.
 * @param daysPerMonth Number of usage days per month (default 22 — work days).
 */
export function projectMonthlyUsd(hoursPerDay: number, daysPerMonth = 22): number {
  if (hoursPerDay < 0 || daysPerMonth < 0) {
    throw new Error('hoursPerDay and daysPerMonth must be non-negative')
  }
  const minutesPerMonth = hoursPerDay * 60 * daysPerMonth
  return minutesPerMonth * GPT_REALTIME_WHISPER_USD_PER_MINUTE
}

/**
 * Format a USD cost as a stable string for tables and logs.
 */
export function formatUsd(usd: number, decimals = 2): string {
  return `$${usd.toFixed(decimals)}`
}
