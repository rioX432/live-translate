import { ipcMain, dialog } from 'electron'
import { readFile, writeFile } from 'fs/promises'
import { store } from '../store'
import type { AppSettings, SubtitleSettings, CorrectionEntry } from '../store'
import { validateSubtitleSettings } from '../ipc-validators'
import type { AppContext } from '../app-context'
import { createLogger } from '../logger'
import {
  parseGlossary,
  detectGlossaryFormat,
  exportJsonGlossary,
  exportCsvGlossary,
  mergeGlossaries
} from '../../engines/translator/glossary-manager'

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
      orgGlossaryTerms: store.get('orgGlossaryTerms') || [],
      simulMtEnabled: store.get('simulMtEnabled'),
      simulMtWaitK: store.get('simulMtWaitK'),
      whisperVariant: store.get('whisperVariant'),
      moonshineVariant: store.get('moonshineVariant'),
      sherpaOnnxModel: store.get('sherpaOnnxModel'),
      sourceLanguage: store.get('sourceLanguage'),
      targetLanguage: store.get('targetLanguage'),
      wsAudioPort: store.get('wsAudioPort'),
      ttsEnabled: store.get('ttsEnabled'),
      ttsVoice: store.get('ttsVoice'),
      ttsOutputDevice: store.get('ttsOutputDevice'),
      ttsVolume: store.get('ttsVolume'),
      hasCompletedSetup: store.get('hasCompletedSetup'),
      draftSttEnabled: store.get('draftSttEnabled'),
      speakerDiarizationEnabled: store.get('speakerDiarizationEnabled'),
      telemetryConsent: store.get('telemetryConsent'),
      telemetryConsentShown: store.get('telemetryConsentShown'),
      showConfidenceIndicator: store.get('showConfidenceIndicator'),
      isFirstRun: store.get('isFirstRun'),
      onboardingModelStatus: store.get('onboardingModelStatus'),
      onboardingDownloadProgress: store.get('onboardingDownloadProgress'),
      preferredLocalEngine: store.get('preferredLocalEngine')
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

  /** Sync the merged glossary (personal + org) to the running pipeline */
  function syncMergedGlossary(): void {
    if (!ctx.pipeline) return
    const personal = store.get('glossaryTerms') || []
    const org = store.get('orgGlossaryTerms') || []
    ctx.pipeline.setGlossary(mergeGlossaries(personal, org))
  }

  // Glossary terms persistence (#240)
  ipcMain.handle('save-glossary', (_event, terms: Array<{ source: string; target: string }>) => {
    store.set('glossaryTerms', terms)
    syncMergedGlossary()
  })

  // Organization glossary persistence (#517)
  ipcMain.handle('save-org-glossary', (_event, terms: Array<{ source: string; target: string }>) => {
    store.set('orgGlossaryTerms', terms)
    syncMergedGlossary()
  })

  // Import glossary from file via native dialog (#517)
  ipcMain.handle('import-glossary', async (_event, target: 'personal' | 'org') => {
    const win = ctx.mainWindow
    if (!win) return { error: 'No main window' }

    const result = await dialog.showOpenDialog(win, {
      title: 'Import Glossary',
      filters: [
        { name: 'Glossary Files', extensions: ['json', 'csv'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'CSV', extensions: ['csv'] }
      ],
      properties: ['openFile']
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { canceled: true }
    }

    const filePath = result.filePaths[0]
    try {
      const format = detectGlossaryFormat(filePath)
      if (!format) {
        return { error: 'Unsupported file format. Use .json or .csv files.' }
      }

      const content = await readFile(filePath, 'utf-8')
      const entries = parseGlossary(content, format)

      if (entries.length === 0) {
        return { error: 'No valid glossary entries found in file.' }
      }

      const storeKey = target === 'org' ? 'orgGlossaryTerms' : 'glossaryTerms'
      store.set(storeKey, entries)
      syncMergedGlossary()

      _log.info(`Imported ${entries.length} ${target} glossary entries from ${filePath}`)
      return { entries, count: entries.length }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      _log.error(`Glossary import failed: ${message}`)
      return { error: `Import failed: ${message}` }
    }
  })

  // Export glossary to file via native dialog (#517)
  ipcMain.handle('export-glossary', async (_event, target: 'personal' | 'org', format: 'json' | 'csv') => {
    const win = ctx.mainWindow
    if (!win) return { error: 'No main window' }

    const storeKey = target === 'org' ? 'orgGlossaryTerms' : 'glossaryTerms'
    const terms = store.get(storeKey) || []

    if (terms.length === 0) {
      return { error: 'No glossary terms to export.' }
    }

    const ext = format === 'json' ? 'json' : 'csv'
    const result = await dialog.showSaveDialog(win, {
      title: 'Export Glossary',
      defaultPath: `glossary-${target}.${ext}`,
      filters: [
        { name: format === 'json' ? 'JSON' : 'CSV', extensions: [ext] }
      ]
    })

    if (result.canceled || !result.filePath) {
      return { canceled: true }
    }

    try {
      const content = format === 'json'
        ? exportJsonGlossary(terms)
        : exportCsvGlossary(terms)
      await writeFile(result.filePath, content, 'utf-8')
      _log.info(`Exported ${terms.length} ${target} glossary entries to ${result.filePath}`)
      return { success: true, path: result.filePath, count: terms.length }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      _log.error(`Glossary export failed: ${message}`)
      return { error: `Export failed: ${message}` }
    }
  })

  // Get merged glossary preview (#517)
  ipcMain.handle('get-merged-glossary', () => {
    const personal = store.get('glossaryTerms') || []
    const org = store.get('orgGlossaryTerms') || []
    const merged = mergeGlossaries(personal, org)
    // Find conflicts: entries where same source exists in both with different targets
    const personalMap = new Map(personal.map((e) => [e.source, e.target]))
    const conflicts = org
      .filter((e) => personalMap.has(e.source) && personalMap.get(e.source) !== e.target)
      .map((e) => ({
        source: e.source,
        personalTarget: personalMap.get(e.source)!,
        orgTarget: e.target
      }))
    return { merged, conflicts, personalCount: personal.length, orgCount: org.length }
  })

  // Save a user correction as a glossary entry and record in correction history (#590)
  ipcMain.handle('save-correction', (_event, correction: {
    sourceText: string
    originalTranslation: string
    correctedTranslation: string
  }) => {
    const { sourceText, originalTranslation, correctedTranslation } = correction
    if (!sourceText?.trim() || !correctedTranslation?.trim()) {
      return { error: 'Source text and corrected translation are required' }
    }

    // Add to personal glossary (deduplicates by source term)
    const glossary = store.get('glossaryTerms') || []
    const existingIdx = glossary.findIndex((e) => e.source === sourceText)
    if (existingIdx >= 0) {
      glossary[existingIdx] = { source: sourceText, target: correctedTranslation }
    } else {
      glossary.push({ source: sourceText, target: correctedTranslation })
    }
    store.set('glossaryTerms', glossary)
    syncMergedGlossary()

    // Record in correction history
    const history = store.get('correctionHistory') || []
    const entry: CorrectionEntry = {
      sourceText,
      originalTranslation: originalTranslation || '',
      correctedTranslation,
      timestamp: Date.now()
    }
    // Keep last 500 entries to avoid unbounded growth
    history.push(entry)
    if (history.length > 500) history.splice(0, history.length - 500)
    store.set('correctionHistory', history)

    _log.info(`Correction saved: "${sourceText}" -> "${correctedTranslation}" (was: "${originalTranslation}")`)
    return { success: true, glossaryCount: glossary.length }
  })

  // Get correction history (#590)
  ipcMain.handle('get-correction-history', () => {
    return store.get('correctionHistory') || []
  })

  // Clear correction history (#590)
  ipcMain.handle('clear-correction-history', () => {
    store.set('correctionHistory', [])
    return { success: true }
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
