import { describe, it, expect } from 'vitest'
import { validateSettingsUpdate } from './settings-validation'

describe('validateSettingsUpdate', () => {
  it('accepts allowlisted, correctly typed settings', () => {
    const entries = validateSettingsUpdate({ saveTranscripts: true, streamingIntervalMs: 800, audioSource: 'both' })
    expect(entries).toEqual([
      ['saveTranscripts', true],
      ['streamingIntervalMs', 800],
      ['audioSource', 'both']
    ])
  })

  it.each(['activeSession', 'wsAudioPort', 'isFirstRun', 'googleApiKey', 'encryptionKey', '__proto__x'])(
    'rejects non-allowlisted key %s',
    (key) => {
      expect(() => validateSettingsUpdate({ [key]: 'x' })).toThrow(/cannot be saved/)
    }
  )

  it('rejects wrongly typed values', () => {
    expect(() => validateSettingsUpdate({ saveTranscripts: 'yes' })).toThrow(/Invalid value/)
    expect(() => validateSettingsUpdate({ streamingIntervalMs: 10 })).toThrow(/Invalid value/)
    expect(() => validateSettingsUpdate({ audioSource: 'network' })).toThrow(/Invalid value/)
  })

  it('rejects non-object payloads', () => {
    expect(() => validateSettingsUpdate(null)).toThrow()
    expect(() => validateSettingsUpdate([])).toThrow()
  })

  it('is all-or-nothing: one bad key rejects the whole update', () => {
    expect(() => validateSettingsUpdate({ saveTranscripts: true, activeSession: null })).toThrow()
  })
})
