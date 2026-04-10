import { execSync } from 'child_process'
import { createLogger } from './logger'

const log = createLogger('mdm-config')

/** MDM-managed configuration profile for enterprise deployment */
export interface MdmConfig {
  /** Lock engine selection to a specific engine mode */
  lockedEngine: string | null
  /** Lock STT engine to a specific engine */
  lockedSttEngine: string | null
  /** Force-disable telemetry regardless of user preference */
  telemetryDisabled: boolean
  /** Managed API key (set by admin, hidden from user) */
  managedApiKey: string | null
  /** Managed DeepL API key */
  managedDeeplApiKey: string | null
  /** Managed Gemini API key */
  managedGeminiApiKey: string | null
  /** Custom organization name shown in UI */
  organizationName: string | null
  /** Disable auto-update (enterprise may manage updates via MDM) */
  autoUpdateDisabled: boolean
}

const BUNDLE_ID = 'com.live-translate.app'
const MDM_READ_TIMEOUT_MS = 2000

/** Cached MDM config — loaded once at startup */
let cachedConfig: MdmConfig | null = null

/**
 * Read a single managed preference value from the macOS defaults system.
 *
 * On macOS, MDM-deployed configuration profiles write to
 * /Library/Managed Preferences/<bundle-id>.plist
 * which can be read via `defaults read` in the managed domain.
 *
 * Returns null if the key doesn't exist or on non-macOS platforms.
 */
function readManagedPref(key: string): string | null {
  if (process.platform !== 'darwin') return null

  try {
    // Read from the managed preferences domain
    // MDM profiles are deployed to /Library/Managed Preferences/
    const result = execSync(
      `defaults read "/Library/Managed Preferences/${BUNDLE_ID}" ${key} 2>/dev/null`,
      { encoding: 'utf-8', timeout: MDM_READ_TIMEOUT_MS }
    ).trim()
    return result || null
  } catch {
    // Key not found or not managed — this is expected for non-managed devices
    return null
  }
}

/**
 * Load MDM configuration from macOS managed preferences.
 *
 * This is a stub that reads from the standard macOS managed preferences domain.
 * An MDM admin would deploy a configuration profile with:
 *
 * ```xml
 * <dict>
 *   <key>PayloadType</key>
 *   <string>com.live-translate.app</string>
 *   <key>lockedEngine</key>
 *   <string>offline-opus</string>
 *   <key>lockedSttEngine</key>
 *   <string>mlx-whisper</string>
 *   <key>telemetryDisabled</key>
 *   <true/>
 *   <key>organizationName</key>
 *   <string>Acme Corp</string>
 *   <key>autoUpdateDisabled</key>
 *   <true/>
 * </dict>
 * ```
 *
 * On non-macOS platforms, returns all-null/false config (no MDM enforcement).
 */
export function loadMdmConfig(): MdmConfig {
  if (cachedConfig) return cachedConfig

  log.info('Loading MDM managed preferences...')

  const config: MdmConfig = {
    lockedEngine: readManagedPref('lockedEngine'),
    lockedSttEngine: readManagedPref('lockedSttEngine'),
    telemetryDisabled: readManagedPref('telemetryDisabled') === '1',
    managedApiKey: readManagedPref('managedApiKey'),
    managedDeeplApiKey: readManagedPref('managedDeeplApiKey'),
    managedGeminiApiKey: readManagedPref('managedGeminiApiKey'),
    organizationName: readManagedPref('organizationName'),
    autoUpdateDisabled: readManagedPref('autoUpdateDisabled') === '1'
  }

  // Log which settings are managed (without revealing sensitive values)
  const managed: string[] = []
  if (config.lockedEngine) managed.push(`lockedEngine=${config.lockedEngine}`)
  if (config.lockedSttEngine) managed.push(`lockedSttEngine=${config.lockedSttEngine}`)
  if (config.telemetryDisabled) managed.push('telemetryDisabled')
  if (config.managedApiKey) managed.push('managedApiKey=***')
  if (config.managedDeeplApiKey) managed.push('managedDeeplApiKey=***')
  if (config.managedGeminiApiKey) managed.push('managedGeminiApiKey=***')
  if (config.organizationName) managed.push(`org=${config.organizationName}`)
  if (config.autoUpdateDisabled) managed.push('autoUpdateDisabled')

  if (managed.length > 0) {
    log.info('MDM managed settings:', managed.join(', '))
  } else {
    log.info('No MDM managed preferences found (unmanaged device)')
  }

  cachedConfig = config
  return config
}

/** Get the cached MDM config (must call loadMdmConfig first) */
export function getMdmConfig(): MdmConfig {
  return cachedConfig ?? loadMdmConfig()
}

/** Check if a specific setting is admin-locked */
export function isEngineLocked(): boolean {
  return getMdmConfig().lockedEngine !== null
}

/** Check if STT engine is admin-locked */
export function isSttEngineLocked(): boolean {
  return getMdmConfig().lockedSttEngine !== null
}

/** Clear cached config (for testing or config reload) */
export function clearMdmConfigCache(): void {
  cachedConfig = null
}
