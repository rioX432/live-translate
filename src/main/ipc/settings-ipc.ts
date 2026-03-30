import { ipcMain } from 'electron'
import { store } from '../store'
import type { AppSettings, SubtitleSettings } from '../store'
import { validateSubtitleSettings } from '../ipc-validators'
import type { AppContext } from '../app-context'
import { createLogger } from '../logger'

const _log = createLogger('ipc:settings')

/** Register settings persistence IPC handlers */
export function registerSettingsIpc(ctx: AppContext): void {
  ipcMain.handle('get-settings', () => {
    return {
      translationEngine: store.get('translationEngine'),
      googleApiKey: store.get('googleApiKey'),
      deeplApiKey: store.get('deeplApiKey'),
      geminiApiKey: store.get('geminiApiKey'),
      microsoftApiKey: store.get('microsoftApiKey'),
      microsoftRegion: store.get('microsoftRegion'),
      sttEngine: store.get('sttEngine'),
      selectedMicrophone: store.get('selectedMicrophone'),
      selectedDisplay: store.get('selectedDisplay'),
      subtitleSettings: store.get('subtitleSettings'),
      slmKvCacheQuant: store.get('slmKvCacheQuant'),
      slmModelSize: store.get('slmModelSize'),
      slmSpeculativeDecoding: store.get('slmSpeculativeDecoding'),
      glossaryTerms: store.get('glossaryTerms') || [],
      simulMtEnabled: store.get('simulMtEnabled'),
      simulMtWaitK: store.get('simulMtWaitK'),
      whisperVariant: store.get('whisperVariant'),
      moonshineVariant: store.get('moonshineVariant'),
      sherpaOnnxModel: store.get('sherpaOnnxModel'),
      sourceLanguage: store.get('sourceLanguage'),
      targetLanguage: store.get('targetLanguage'),
      wsAudioPort: store.get('wsAudioPort')
    }
  })

  ipcMain.handle('save-subtitle-settings', (_event, settings: Record<string, unknown>) => {
    const validationError = validateSubtitleSettings(settings)
    if (validationError) {
      throw new Error(`Invalid subtitle settings: ${validationError}`)
    }
    const validated = settings as unknown as SubtitleSettings
    store.set('subtitleSettings', validated)
    ctx.subtitleWindow?.webContents.send('subtitle-settings-changed', validated)
  })

  ipcMain.handle('save-settings', (_event, settings: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(settings)) {
      store.set(key as keyof AppSettings, value as never)
    }
  })

  // Glossary terms persistence (#240)
  ipcMain.handle('save-glossary', (_event, terms: Array<{ source: string; target: string }>) => {
    store.set('glossaryTerms', terms)
    // Update running pipeline glossary in real-time
    if (ctx.pipeline) {
      ctx.pipeline.setGlossary(terms)
    }
  })

  // #54: crash recovery — check if previous session ended uncleanly
  ipcMain.handle('get-crashed-session', () => {
    const session = store.get('activeSession')
    if (session) {
      // Clear it so we don't keep detecting the same crash
      store.set('activeSession', null)
      // Validate config has required fields
      const config = session.config
      if (config && typeof config === 'object' && config.mode) {
        return session
      }
      _log.warn('Invalid session config, discarding:', config)
    }
    return null
  })
}
