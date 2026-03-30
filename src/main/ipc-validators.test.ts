import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, symlinkSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { validateSessionId, validateSearchQuery, validatePathWithinDir } from './ipc-validators'

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

describe('validatePathWithinDir', () => {
  const testDir = join(tmpdir(), 'path-traversal-test-' + process.pid)
  const innerDir = join(testDir, 'inner')
  const outsideDir = join(tmpdir(), 'path-traversal-outside-' + process.pid)

  beforeAll(() => {
    mkdirSync(innerDir, { recursive: true })
    mkdirSync(outsideDir, { recursive: true })
    writeFileSync(join(innerDir, 'valid.txt'), 'ok')
    writeFileSync(join(outsideDir, 'secret.txt'), 'secret')
    // Create symlink inside testDir pointing outside
    symlinkSync(join(outsideDir, 'secret.txt'), join(innerDir, 'symlink-escape.txt'))
  })

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true })
    rmSync(outsideDir, { recursive: true, force: true })
  })

  it('accepts a valid path within the base directory', () => {
    const result = validatePathWithinDir(join(innerDir, 'valid.txt'), testDir)
    expect(result).toHaveProperty('path')
    expect((result as { path: string }).path).toContain('valid.txt')
  })

  it('rejects path traversal via ../', () => {
    const result = validatePathWithinDir(join(testDir, '..', 'etc', 'passwd'), testDir)
    expect(result).toHaveProperty('error')
  })

  it('rejects symlink that escapes the base directory', () => {
    const result = validatePathWithinDir(join(innerDir, 'symlink-escape.txt'), testDir)
    expect(result).toHaveProperty('error')
  })

  it('rejects non-existent path', () => {
    const result = validatePathWithinDir(join(testDir, 'nonexistent.txt'), testDir)
    expect(result).toHaveProperty('error')
  })

  it('rejects path with prefix trick (e.g. /base-dir-evil)', () => {
    // Create a sibling dir whose name starts with testDir name
    const trickDir = testDir + '-evil'
    mkdirSync(trickDir, { recursive: true })
    writeFileSync(join(trickDir, 'trick.txt'), 'trick')
    try {
      const result = validatePathWithinDir(join(trickDir, 'trick.txt'), testDir)
      expect(result).toHaveProperty('error')
    } finally {
      rmSync(trickDir, { recursive: true, force: true })
    }
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
