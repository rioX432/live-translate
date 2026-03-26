/** Max length for session IDs */
const SESSION_ID_MAX_LENGTH = 128

/** Allowed characters for session IDs: alphanumeric, hyphens, underscores, T (ISO timestamp separator) */
const SESSION_ID_PATTERN = /^[a-zA-Z0-9\-_T]+$/

/** Validate a session ID from IPC input. Returns error string or null if valid. */
export function validateSessionId(id: unknown): string | null {
  if (typeof id !== 'string') return 'Session ID must be a string'
  if (id.length === 0) return 'Session ID must not be empty'
  if (id.length > SESSION_ID_MAX_LENGTH) return `Session ID exceeds max length (${SESSION_ID_MAX_LENGTH})`
  if (!SESSION_ID_PATTERN.test(id)) return 'Session ID contains invalid characters'
  return null
}

/** Validate a search query from IPC input. Returns error string or null if valid. */
export function validateSearchQuery(query: unknown): string | null {
  if (typeof query !== 'string') return 'Search query must be a string'
  if (query.length === 0) return 'Search query must not be empty'
  if (query.length > 256) return 'Search query exceeds max length (256)'
  return null
}

/** Valid export formats */
export const VALID_EXPORT_FORMATS = ['text', 'srt', 'markdown'] as const
export type ExportFormat = (typeof VALID_EXPORT_FORMATS)[number]
