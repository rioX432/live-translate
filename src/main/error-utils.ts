/** Scrub token-shaped strings from error messages before sending to renderer (#209) */
export function sanitizeErrorMessage(message: string): string {
  let sanitized = message
  // The app holds no API keys; this only catches token-shaped strings echoed back by a download host
  sanitized = sanitized.replace(/AIza[0-9A-Za-z\-_]{35}/g, '***')
  sanitized = sanitized.replace(/sk-[A-Za-z0-9\-_]{20,}/g, '***')
  return sanitized
}

/** Map error patterns to actionable hints */
export function getErrorHint(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return ' — Check your internet connection (needed only to download models)'
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return ' — Check your internet connection'
  }
  if (lower.includes('model') || lower.includes('download')) {
    return ' — Model download issue, try restarting'
  }
  return ''
}
