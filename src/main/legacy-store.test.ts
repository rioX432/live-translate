import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { decryptLegacyConfig, migrateLegacyStoreFile, stripRemovedSettings } from './legacy-store'

/** Reproduces conf's encryptionKey format: iv + ':' + aes-256-cbc ciphertext, pbkdf2(key, iv.toString()) */
function encryptLikeConf(settings: Record<string, unknown>, key = 'live-translate-v1'): Buffer {
  const iv = crypto.randomBytes(16)
  const password = crypto.pbkdf2Sync(key, iv.toString(), 10_000, 32, 'sha512')
  const cipher = crypto.createCipheriv('aes-256-cbc', password, iv)
  return Buffer.concat([iv, Buffer.from(':'), cipher.update(JSON.stringify(settings), 'utf-8'), cipher.final()])
}

const LEGACY = {
  translationEngine: 'rotation',
  targetLanguage: 'ja',
  googleApiKey: 'AIza-test-secret',
  deeplApiKey: 'deepl-test-secret',
  openaiApiKey: 'sk-test-secret',
  microsoftRegion: 'japaneast',
  quotaTracking: { google: 1 },
  activeSession: { config: { mode: 'cascade' }, startedAt: 1 }
}

describe('legacy settings migration', () => {
  let dir: string
  let file: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-store-'))
    file = path.join(dir, 'config.json')
  })
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('decrypts a file written with the old fixed key', () => {
    expect(decryptLegacyConfig(encryptLikeConf(LEGACY))).toMatchObject({ targetLanguage: 'ja' })
  })

  it('returns null for a different key or garbage', () => {
    expect(decryptLegacyConfig(encryptLikeConf(LEGACY, 'other-key'))).toBeNull()
    expect(decryptLegacyConfig(Buffer.from('not a config file at all'))).toBeNull()
  })

  it('rewrites an encrypted file as plain JSON without any secret, keeping other settings', () => {
    fs.writeFileSync(file, encryptLikeConf(LEGACY))
    expect(migrateLegacyStoreFile(file)).toBe('decrypted')

    const raw = fs.readFileSync(file, 'utf-8')
    expect(JSON.parse(raw)).toEqual({ translationEngine: 'rotation', targetLanguage: 'ja' })
    expect(raw).not.toContain('secret')
    expect(fs.existsSync(`${file}.migrating`)).toBe(false)
  })

  it('removes leftover keys from an already-plain file', () => {
    fs.writeFileSync(file, JSON.stringify({ targetLanguage: 'en', geminiApiKey: 'x' }))
    expect(migrateLegacyStoreFile(file)).toBe('plain-cleaned')
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ targetLanguage: 'en' })
  })

  it('leaves a clean plain file untouched', () => {
    const content = JSON.stringify({ targetLanguage: 'en' })
    fs.writeFileSync(file, content)
    expect(migrateLegacyStoreFile(file)).toBe('plain-unchanged')
    expect(fs.readFileSync(file, 'utf-8')).toBe(content)
  })

  it('does nothing when no file exists', () => {
    expect(migrateLegacyStoreFile(file)).toBe('missing')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('never modifies an unreadable file', () => {
    const garbage = Buffer.from('garbage-bytes-that-are-neither-json-nor-encrypted')
    fs.writeFileSync(file, garbage)
    expect(migrateLegacyStoreFile(file)).toBe('unreadable')
    expect(fs.readFileSync(file).equals(garbage)).toBe(true)
  })

  it('is idempotent', () => {
    fs.writeFileSync(file, encryptLikeConf(LEGACY))
    migrateLegacyStoreFile(file)
    expect(migrateLegacyStoreFile(file)).toBe('plain-unchanged')
  })

  it('stripRemovedSettings does not mutate its input', () => {
    const input = { googleApiKey: 'a', targetLanguage: 'en' }
    expect(stripRemovedSettings(input)).toEqual({ targetLanguage: 'en' })
    expect(input.googleApiKey).toBe('a')
  })
})
