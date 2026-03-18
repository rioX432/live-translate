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
  activeSession: ActiveSession | null
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
    activeSession: null
  }
})
