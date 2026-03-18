import Store from 'electron-store'

export interface QuotaRecord {
  monthKey: string
  charCount: number
}

/** Persisted session state for crash recovery (#54) */
export interface ActiveSession {
  config: Record<string, unknown>
  startedAt: number
}

export interface QuotaLimits {
  azure: number
  google: number
  deepl: number
}

export interface AppSettings {
  translationEngine: string
  googleApiKey: string
  microsoftApiKey: string
  microsoftRegion: string
  deeplApiKey: string
  geminiApiKey: string
  selectedMicrophone: string
  selectedDisplay: number
  quotaTracking: Record<string, QuotaRecord>
  quotaLimits: QuotaLimits
  activeSession: ActiveSession | null
}

/** Validate that a recovered session config is still usable */
export function validateSessionConfig(session: ActiveSession): boolean {
  if (!session || !session.config || !session.startedAt) return false

  const config = session.config as Record<string, unknown>

  // Must have a valid mode
  if (config.mode !== 'cascade' && config.mode !== 'e2e') return false

  // cascade mode requires both IDs
  if (config.mode === 'cascade') {
    if (!config.sttEngineId || !config.translatorEngineId) return false
  }

  // e2e mode requires e2eEngineId
  if (config.mode === 'e2e') {
    if (!config.e2eEngineId) return false
  }

  // Reject sessions older than 7 days
  const age = Date.now() - session.startedAt
  if (age < 0 || age > 7 * 24 * 60 * 60 * 1000) return false

  return true
}

export const store = new Store<AppSettings>({
  defaults: {
    translationEngine: 'google-translate',
    googleApiKey: '',
    microsoftApiKey: '',
    microsoftRegion: '',
    deeplApiKey: '',
    geminiApiKey: '',
    selectedMicrophone: '',
    selectedDisplay: 0,
    quotaTracking: {},
    quotaLimits: {
      azure: 2_000_000,
      google: 480_000,
      deepl: 500_000
    },
    activeSession: null
  }
})
