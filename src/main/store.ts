import Store from 'electron-store'

export interface AppSettings {
  translationEngine: string
  googleApiKey: string
  microsoftApiKey: string
  microsoftRegion: string
  deeplApiKey: string
  geminiApiKey: string
  selectedMicrophone: string
  selectedDisplay: number
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
    selectedDisplay: 0
  }
})
