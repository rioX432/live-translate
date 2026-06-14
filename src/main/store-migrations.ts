/**
 * Persisted-store migrations applied at app startup.
 *
 * Migrations operate on a minimal `Store` shape so they remain unit-testable
 * without booting electron-store or Electron itself.
 */

/** Persisted-store keys that migrations may read or write */
export type MigratableKey = 'translationEngine' | 'adaptiveRoutingQualityEngine'

/** Subset of the electron-store API used by migrations */
export interface MigratableStore {
  get(key: MigratableKey): unknown
  set(key: MigratableKey, value: string): void
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
 * Legacy `adaptiveRoutingQualityEngine` IDs removed from the UI in #705.
 * Each entry maps the legacy value to the replacement engine ID.
 */
export const LEGACY_ADAPTIVE_QUALITY_ENGINES: Readonly<Record<string, string>> = {
  plamo: 'hunyuan-mt'
} as const

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

/**
 * #705: If the persisted `adaptiveRoutingQualityEngine` value is one of the
 * legacy IDs removed from the UI's quality engine selector, rewrite it to the
 * mapped replacement so adaptive routing does not silently fall back when the
 * stored quality engine no longer matches a selectable option.
 *
 * Returns true when a migration was applied, false otherwise.
 */
export function migrateLegacyAdaptiveRoutingQualityEngine(
  store: MigratableStore,
  logger?: MigrationLogger
): boolean {
  const current = store.get('adaptiveRoutingQualityEngine')
  if (typeof current !== 'string') return false
  const replacement = LEGACY_ADAPTIVE_QUALITY_ENGINES[current]
  if (!replacement) return false
  logger?.info(`Migrating adaptiveRoutingQualityEngine from "${current}" to "${replacement}"`)
  store.set('adaptiveRoutingQualityEngine', replacement)
  return true
}
