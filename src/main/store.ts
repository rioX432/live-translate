import Store from 'electron-store'

export interface QuotaRecord {
  monthKey: string
  charCount: number
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
    quotaTracking: {}
  }
})
