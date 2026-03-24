import { store } from './store'

/** Scrub API keys from error messages before sending to renderer (#209) */
export function sanitizeErrorMessage(message: string): string {
  const settings = store.store as unknown as Record<string, unknown>
  const secrets = [
    settings.googleApiKey,
    settings.deeplApiKey,
    settings.geminiApiKey,
    settings.microsoftApiKey
  ].filter((s): s is string => typeof s === 'string' && s.length > 8)

  let sanitized = message
  for (const secret of secrets) {
    sanitized = sanitized.split(secret).join('***')
  }
  // Also scrub common API key patterns that may leak from HTTP responses
  sanitized = sanitized.replace(/AIza[0-9A-Za-z\-_]{35}/g, '***')
  return sanitized
}

/** Map error patterns to actionable hints */
export function getErrorHint(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('api key') || lower.includes('401') || lower.includes('403')) {
    return ' — Check your API key in settings'
  }
  if (lower.includes('rate limit') || lower.includes('429') || lower.includes('quota')) {
    return ' — API quota exceeded, try a different provider'
  }
  if (lower.includes('timed out') || lower.includes('timeout')) {
    return ' — Check your internet connection'
  }
  if (lower.includes('network') || lower.includes('fetch')) {
    return ' — Check your internet connection'
  }
  if (lower.includes('model') || lower.includes('download')) {
    return ' — Model download issue, try restarting'
  }
  return ''
}
