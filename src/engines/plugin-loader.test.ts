import { describe, it, expect } from 'vitest'
import { validateManifest } from './plugin-loader'

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'test-plugin',
    version: '1.0.0',
    description: 'A test plugin',
    engineType: 'stt',
    engineId: 'test-stt',
    entryPoint: 'index.js',
    ...overrides
  }
}

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    expect(validateManifest(validManifest())).toBeNull()
  })

  it('accepts valid manifest with optional fields', () => {
    expect(
      validateManifest(
        validManifest({
          supportedLanguages: ['en', 'ja'],
          author: 'Test Author',
          homepage: 'https://example.com'
        })
      )
    ).toBeNull()
  })

  it('accepts all engine types', () => {
    for (const engineType of ['stt', 'translator', 'e2e']) {
      expect(validateManifest(validManifest({ engineType }))).toBeNull()
    }
  })

  // Non-object inputs
  it('rejects null', () => {
    expect(validateManifest(null)).toBe('Manifest must be a non-null object')
  })

  it('rejects array', () => {
    expect(validateManifest([])).toBe('Manifest must be a non-null object')
  })

  it('rejects string', () => {
    expect(validateManifest('string')).toBe('Manifest must be a non-null object')
  })

  // Required string fields
  it.each(['name', 'version', 'description', 'engineId', 'entryPoint'])(
    'rejects missing %s',
    (field) => {
      const m = validManifest()
      delete m[field]
      expect(validateManifest(m)).toContain(`"${field}" must be a string`)
    }
  )

  it.each(['name', 'version', 'description', 'engineId', 'entryPoint'])(
    'rejects empty %s',
    (field) => {
      expect(validateManifest(validManifest({ [field]: '' }))).toContain('must not be empty')
    }
  )

  it.each(['name', 'version', 'description', 'engineId', 'entryPoint'])(
    'rejects whitespace-only %s',
    (field) => {
      expect(validateManifest(validManifest({ [field]: '   ' }))).toContain('must not be empty')
    }
  )

  // Version format
  it('rejects invalid version format', () => {
    expect(validateManifest(validManifest({ version: 'abc' }))).toContain('semver')
  })

  it('accepts version with prerelease', () => {
    expect(validateManifest(validManifest({ version: '1.0.0-beta.1' }))).toBeNull()
  })

  // engineType
  it('rejects invalid engineType', () => {
    expect(validateManifest(validManifest({ engineType: 'invalid' }))).toContain(
      '"engineType" must be one of'
    )
  })

  it('rejects missing engineType', () => {
    const m = validManifest()
    delete m.engineType
    expect(validateManifest(m)).toContain('"engineType" must be a string')
  })

  // engineId format
  it('rejects engineId with special characters', () => {
    expect(validateManifest(validManifest({ engineId: 'bad/id' }))).toContain(
      'alphanumeric characters'
    )
  })

  it('accepts engineId with hyphens and underscores', () => {
    expect(validateManifest(validManifest({ engineId: 'my-engine_v2' }))).toBeNull()
  })

  // entryPoint path traversal
  it('rejects entryPoint with path traversal', () => {
    expect(validateManifest(validManifest({ entryPoint: '../escape.js' }))).toContain(
      'traversal'
    )
  })

  it('rejects entryPoint starting with absolute path', () => {
    expect(validateManifest(validManifest({ entryPoint: '/etc/passwd' }))).toContain(
      'relative path'
    )
  })

  it('rejects entryPoint starting with backslash', () => {
    expect(validateManifest(validManifest({ entryPoint: '\\windows\\bad' }))).toContain(
      'relative path'
    )
  })

  it('accepts nested entryPoint', () => {
    expect(validateManifest(validManifest({ entryPoint: 'dist/index.js' }))).toBeNull()
  })

  // supportedLanguages
  it('rejects non-array supportedLanguages', () => {
    expect(validateManifest(validManifest({ supportedLanguages: 'en' }))).toContain(
      'array of strings'
    )
  })

  it('rejects supportedLanguages with non-string items', () => {
    expect(validateManifest(validManifest({ supportedLanguages: ['en', 42] }))).toContain(
      'non-empty strings'
    )
  })

  it('rejects supportedLanguages with empty strings', () => {
    expect(validateManifest(validManifest({ supportedLanguages: ['en', ''] }))).toContain(
      'non-empty strings'
    )
  })

  // Optional string fields
  it('rejects non-string author', () => {
    expect(validateManifest(validManifest({ author: 123 }))).toContain(
      '"author" must be a string'
    )
  })

  it('rejects non-string homepage', () => {
    expect(validateManifest(validManifest({ homepage: true }))).toContain(
      '"homepage" must be a string'
    )
  })
})
