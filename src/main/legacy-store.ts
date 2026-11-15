import crypto from 'crypto'
import fs from 'fs'

/**
 * One-time migration of the pre-local-only settings file.
 *
 * Older builds encrypted config.json with a fixed key embedded in the source
 * (obfuscation only — the key shipped with every copy of the app). The app now holds
 * no secrets, so the file is stored as plain JSON. This reads the old format once,
 * drops every credential and the crash-recovery session, and rewrites the file.
 */

/** The fixed key used by the removed encryption. Needed only to read old files. */
const LEGACY_ENCRYPTION_KEY = 'live-translate-v1'
const ALGORITHM = 'aes-256-cbc'
const IV_LENGTH = 16
const PBKDF2_ITERATIONS = 10_000
const PBKDF2_KEY_LENGTH = 32

/** Settings keys that held secrets, cloud routing or meeting content and must not survive the migration */
export const REMOVED_SETTINGS_KEYS: readonly string[] = [
  'googleApiKey',
  'microsoftApiKey',
  'microsoftRegion',
  'deeplApiKey',
  'geminiApiKey',
  'openaiApiKey',
  'geminiLiveApiKey',
  'cloudRealtimeEnabled',
  'geminiLiveEnabled',
  'quotaTracking',
  // Holds the pipeline config of the last session; session persistence is opt-in now
  'activeSession',
  // Whole transcript sentences and engine translations saved by subtitle corrections;
  // the app no longer stores meeting content
  'correctionHistory'
]

export interface LegacyStoreLogger {
  info: (message: string) => void
  warn: (message: string) => void
}

/** Decrypt a file written by conf's encryptionKey option (iv + ':' + aes-256-cbc), or null on failure */
export function decryptLegacyConfig(
  data: Buffer,
  key: string = LEGACY_ENCRYPTION_KEY
): Record<string, unknown> | null {
  try {
    if (data.length <= IV_LENGTH + 1) return null
    const iv = data.subarray(0, IV_LENGTH)
    // conf derives the password from the IV's string form, not its raw bytes
    const password = crypto.pbkdf2Sync(key, iv.toString(), PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, 'sha512')
    const decipher = crypto.createDecipheriv(ALGORITHM, password, iv)
    const plain = Buffer.concat([decipher.update(data.subarray(IV_LENGTH + 1)), decipher.final()]).toString('utf-8')
    const parsed: unknown = JSON.parse(plain)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Subtitle corrections in older builds also saved the whole sentence and its corrected
 * translation as a personal glossary entry. Drop the entries the history still
 * identifies (exact source and target); an entry the user edited later is kept.
 */
function withoutCorrectionEntries(glossary: unknown, history: unknown): unknown[] | null {
  if (!Array.isArray(glossary) || !Array.isArray(history) || history.length === 0) return null
  const saved = new Set<string>()
  for (const h of history) {
    if (isRecord(h) && typeof h.sourceText === 'string' && typeof h.correctedTranslation === 'string') {
      saved.add(JSON.stringify([h.sourceText, h.correctedTranslation]))
    }
  }
  return glossary.filter((e) => !(isRecord(e) && saved.has(JSON.stringify([e.source, e.target]))))
}

/** Return a copy of the settings without the removed keys or the meeting content they left behind */
export function stripRemovedSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...settings }
  const glossary = withoutCorrectionEntries(copy.glossaryTerms, copy.correctionHistory)
  if (glossary) copy.glossaryTerms = glossary
  for (const key of REMOVED_SETTINGS_KEYS) delete copy[key]
  return copy
}

export type LegacyMigrationResult = 'missing' | 'plain-cleaned' | 'plain-unchanged' | 'decrypted' | 'unreadable'

/**
 * Migrate the settings file at `filePath` in place. Plain-JSON files (already migrated)
 * only have leftover secret keys removed. An unreadable file is left untouched so a
 * user's data is never destroyed here.
 */
export function migrateLegacyStoreFile(filePath: string, logger?: LegacyStoreLogger): LegacyMigrationResult {
  if (!fs.existsSync(filePath)) return 'missing'
  const raw = fs.readFileSync(filePath)

  let settings: Record<string, unknown> | null = null
  let wasEncrypted = false
  try {
    const parsed: unknown = JSON.parse(raw.toString('utf-8'))
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) settings = parsed as Record<string, unknown>
  } catch {
    settings = decryptLegacyConfig(raw)
    wasEncrypted = settings !== null
  }

  if (!settings) {
    logger?.warn('Settings file is neither plain JSON nor the legacy format; leaving it untouched')
    return 'unreadable'
  }

  const cleaned = stripRemovedSettings(settings)
  const changed = Object.keys(cleaned).length !== Object.keys(settings).length
  if (!wasEncrypted && !changed) return 'plain-unchanged'

  // Temp file + rename so a crash cannot leave a half-written settings file
  const tmp = `${filePath}.migrating`
  fs.writeFileSync(tmp, JSON.stringify(cleaned, undefined, '\t'), { mode: 0o600 })
  fs.renameSync(tmp, filePath)
  logger?.info(
    wasEncrypted
      ? 'Migrated encrypted settings to plain JSON (secrets removed)'
      : 'Removed leftover keys from settings'
  )
  return wasEncrypted ? 'decrypted' : 'plain-cleaned'
}
