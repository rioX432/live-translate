import { describe, it, expect } from 'vitest'
import { validateSessionId, validateSearchQuery } from './ipc-validators'

describe('validateSessionId', () => {
  it('accepts valid session IDs', () => {
    expect(validateSessionId('2024-01-15T10-30-00-000')).toBeNull()
    expect(validateSessionId('abc-123_T')).toBeNull()
    expect(validateSessionId('simple')).toBeNull()
  })

  it('rejects non-string input', () => {
    expect(validateSessionId(123)).toBe('Session ID must be a string')
    expect(validateSessionId(null)).toBe('Session ID must be a string')
    expect(validateSessionId(undefined)).toBe('Session ID must be a string')
    expect(validateSessionId({})).toBe('Session ID must be a string')
  })

  it('rejects empty string', () => {
    expect(validateSessionId('')).toBe('Session ID must not be empty')
  })

  it('rejects strings exceeding max length', () => {
    const longId = 'a'.repeat(129)
    expect(validateSessionId(longId)).toBe('Session ID exceeds max length (128)')
  })

  it('rejects path traversal characters', () => {
    expect(validateSessionId('../etc/passwd')).toBe('Session ID contains invalid characters')
    expect(validateSessionId('../../secret')).toBe('Session ID contains invalid characters')
    expect(validateSessionId('foo/bar')).toBe('Session ID contains invalid characters')
    expect(validateSessionId('foo\\bar')).toBe('Session ID contains invalid characters')
  })

  it('rejects special characters', () => {
    expect(validateSessionId('id with spaces')).toBe('Session ID contains invalid characters')
    expect(validateSessionId('id:colon')).toBe('Session ID contains invalid characters')
    expect(validateSessionId('id.dot')).toBe('Session ID contains invalid characters')
  })
})

describe('validateSearchQuery', () => {
  it('accepts valid queries', () => {
    expect(validateSearchQuery('hello world')).toBeNull()
    expect(validateSearchQuery('meeting notes 2024')).toBeNull()
  })

  it('rejects non-string input', () => {
    expect(validateSearchQuery(123)).toBe('Search query must be a string')
    expect(validateSearchQuery(null)).toBe('Search query must be a string')
  })

  it('rejects empty string', () => {
    expect(validateSearchQuery('')).toBe('Search query must not be empty')
  })

  it('rejects queries exceeding max length', () => {
    const longQuery = 'a'.repeat(257)
    expect(validateSearchQuery(longQuery)).toBe('Search query exceeds max length (256)')
  })
})
