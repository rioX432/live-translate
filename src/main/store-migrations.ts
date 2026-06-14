/**
 * Persisted-store migrations applied at app startup.
 *
 * Migrations operate on a minimal `Store` shape so they remain unit-testable
 * without booting electron-store or Electron itself.
 */

/** Subset of the electron-store API used by migrations */
export interface MigratableStore {
  get(key: 'translationEngine'): unknown
  set(key: 'translationEngine', value: string): void
}

/** Minimal logger interface compatible with src/main/logger.ts */
export interface MigrationLogger {
  info: (message: string) => void
}

/**
 * Legacy `translationEngine` IDs trimmed from the UI in #702.
 * Mirrors LEGACY_TRANSLATION_ENGINES in src/renderer/components/settings/shared.ts.
 */
export const LEGACY_TRANSLATION_ENGINES: readonly string[] = [
  'offline-lfm2',
  'offline-plamo',
  'offline-hybrid',
  'offline-opus'
] as const

/**
 * If the persisted `translationEngine` value is one of the removed legacy IDs,
 * rewrite it to `'auto'` so the renderer never has to render an option that
 * no longer exists in the UI.
 *
 * Returns true when a migration was applied, false otherwise.
 */
export function migrateLegacyTranslationEngine(store: MigratableStore, logger?: MigrationLogger): boolean {
  const current = store.get('translationEngine')
  if (typeof current !== 'string') return false
  if (!LEGACY_TRANSLATION_ENGINES.includes(current)) return false
  logger?.info(`Migrating translationEngine from "${current}" to "auto"`)
  store.set('translationEngine', 'auto')
  return true
}
