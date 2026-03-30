import { resolve, relative } from 'path'
import { realpathSync } from 'fs'

/**
 * Validate that a file path resolves to within the given base directory,
 * resolving symlinks to prevent symlink-based traversal attacks.
 * Returns the resolved real path if valid, or an error string.
 */
export function validatePathWithinDir(filePath: string, baseDir: string): { path: string } | { error: string } {
  const resolved = resolve(filePath)

  let realPath: string
  try {
    realPath = realpathSync(resolved)
  } catch {
    return { error: 'Invalid path' }
  }

  let realBase: string
  try {
    realBase = realpathSync(baseDir)
  } catch {
    return { error: 'Invalid base directory' }
  }

  const rel = relative(realBase, realPath)
  if (rel.startsWith('..') || resolve(realBase, rel) !== realPath) {
    return { error: 'Path is outside allowed directory' }
  }

  return { path: realPath }
}

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

/** Valid subtitle position values */
const VALID_SUBTITLE_POSITIONS = ['top', 'bottom'] as const

/**
 * Validate subtitle settings from IPC input.
 * Returns an error string if invalid, or null if valid.
 */
export function validateSubtitleSettings(data: unknown): string | null {
  if (data == null || typeof data !== 'object') return 'Subtitle settings must be an object'

  const obj = data as Record<string, unknown>

  if (typeof obj.fontSize !== 'number' || !Number.isFinite(obj.fontSize)) {
    return 'fontSize must be a finite number'
  }
  if (typeof obj.sourceTextColor !== 'string') return 'sourceTextColor must be a string'
  if (typeof obj.translatedTextColor !== 'string') return 'translatedTextColor must be a string'
  if (typeof obj.backgroundOpacity !== 'number' || !Number.isFinite(obj.backgroundOpacity)) {
    return 'backgroundOpacity must be a finite number'
  }
  if (!VALID_SUBTITLE_POSITIONS.includes(obj.position as (typeof VALID_SUBTITLE_POSITIONS)[number])) {
    return `position must be one of: ${VALID_SUBTITLE_POSITIONS.join(', ')}`
  }

  return null
}

/** Valid export formats */
export const VALID_EXPORT_FORMATS = ['text', 'srt', 'markdown'] as const
export type ExportFormat = (typeof VALID_EXPORT_FORMATS)[number]
