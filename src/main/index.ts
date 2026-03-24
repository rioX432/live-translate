import { app } from 'electron'
import { TranslationPipeline } from '../pipeline/TranslationPipeline'
import { WhisperLocalEngine } from '../engines/stt/WhisperLocalEngine'
import { MlxWhisperEngine } from '../engines/stt/MlxWhisperEngine'
import { MoonshineEngine } from '../engines/stt/MoonshineEngine'
import { SenseVoiceEngine } from '../engines/stt/SenseVoiceEngine'
import { LightningWhisperEngine } from '../engines/stt/LightningWhisperEngine'
import { OpusMTTranslator } from '../engines/translator/OpusMTTranslator'
import { CT2OpusMTTranslator } from '../engines/translator/CT2OpusMTTranslator'
import { CT2Madlad400Translator } from '../engines/translator/CT2Madlad400Translator'
import { SLMTranslator } from '../engines/translator/SLMTranslator'
import { HunyuanMTTranslator } from '../engines/translator/HunyuanMTTranslator'
import { HunyuanMT15Translator } from '../engines/translator/HunyuanMT15Translator'
import { Gemma2JpnTranslator } from '../engines/translator/Gemma2JpnTranslator'
import { AlmaJaTranslator } from '../engines/translator/AlmaJaTranslator'
import { ANETranslator } from '../engines/translator/ANETranslator'
import { HybridTranslator } from '../engines/translator/HybridTranslator'
import { discoverPlugins, loadPluginEngine } from '../engines/plugin-loader'
import { store } from './store'
import { sanitizeErrorMessage, getErrorHint } from './error-utils'
import { createMainWindow, createSubtitleWindow, registerDisplayHandlers } from './window-manager'
import { registerAudioHandlers } from './audio-handlers'
import { registerIpcHandlers } from './ipc-handlers'
import { createLogger } from './logger'
import type { AppContext } from './app-context'
import type { STTEngine, TranslatorEngine, E2ETranslationEngine, TranslationResult } from '../engines/types'
import type { WhisperVariant, MoonshineVariant } from '../engines/model-downloader'

const log = createLogger('main')

// Shared mutable state
const ctx: AppContext = {
  mainWindow: null,
  subtitleWindow: null,
  pipeline: null,
  logger: null,
  wsAudioServer: null
}

function initPipeline(): void {
  ctx.pipeline = new TranslationPipeline()

  // Register STT engines
  ctx.pipeline.registerSTT('whisper-local', () => new WhisperLocalEngine({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
    modelVariant: (store.get('whisperVariant') as WhisperVariant) || undefined
  }))
  // mlx-whisper is Apple Silicon only — skip registration on other platforms
  if (process.platform === 'darwin') {
    ctx.pipeline.registerSTT('mlx-whisper', () => new MlxWhisperEngine({
      onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
    }))
    ctx.pipeline.registerSTT('lightning-whisper', () => new LightningWhisperEngine({
      onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
    }))
  }
  ctx.pipeline.registerSTT('moonshine', () => new MoonshineEngine({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
    variant: (store.get('moonshineVariant') as MoonshineVariant) || undefined
  }))
  ctx.pipeline.registerSTT('sensevoice', () => new SenseVoiceEngine({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
  }))

  // Register translator engines
  ctx.pipeline.registerTranslator('opus-mt', () => new OpusMTTranslator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
  }))
  ctx.pipeline.registerTranslator('ct2-opus-mt', () => new CT2OpusMTTranslator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
  }))
  ctx.pipeline.registerTranslator('ct2-madlad-400', () => new CT2Madlad400Translator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
  }))
  ctx.pipeline.registerTranslator('slm-translate', () => new SLMTranslator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
    kvCacheQuant: store.get('slmKvCacheQuant'),
    modelSize: store.get('slmModelSize'),
    speculativeDecoding: store.get('slmSpeculativeDecoding')
  }))
  ctx.pipeline.registerTranslator('hunyuan-mt', () => new HunyuanMTTranslator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
    kvCacheQuant: store.get('slmKvCacheQuant')
  }))
  ctx.pipeline.registerTranslator('hunyuan-mt-15', () => new HunyuanMT15Translator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
    kvCacheQuant: store.get('slmKvCacheQuant')
  }))
  // JA↔EN specialized models (#312)
  ctx.pipeline.registerTranslator('gemma2-jpn', () => new Gemma2JpnTranslator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
    kvCacheQuant: store.get('slmKvCacheQuant')
  }))
  ctx.pipeline.registerTranslator('alma-ja', () => new AlmaJaTranslator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
    kvCacheQuant: store.get('slmKvCacheQuant')
  }))
  // ANEMLL Apple Neural Engine translator — macOS Apple Silicon only (#241)
  if (process.platform === 'darwin') {
    ctx.pipeline.registerTranslator('ane-translate', () => new ANETranslator({
      onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
    }))
  }
  // Hybrid translator: OPUS-MT instant draft + TranslateGemma refinement (#235)
  ctx.pipeline.registerTranslator('hybrid', () => new HybridTranslator(
    new OpusMTTranslator({
      onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
    }),
    new SLMTranslator({
      onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
      kvCacheQuant: store.get('slmKvCacheQuant'),
      modelSize: store.get('slmModelSize'),
      speculativeDecoding: store.get('slmSpeculativeDecoding')
    })
  ))
  // Auto-register discovered plugins (#145)
  for (const plugin of discoverPlugins()) {
    const { manifest } = plugin
    const factory = () => loadPluginEngine(plugin)
    // Plugin factory returns Promise<STTEngine | TranslatorEngine | E2ETranslationEngine>;
    // Pipeline wraps factory() in Promise.resolve(), so async factories are supported.
    // Cast through unknown because the factory return type is a union Promise.
    if (manifest.engineType === 'stt') {
      ctx.pipeline.registerSTT(manifest.engineId, factory as unknown as () => STTEngine)
    } else if (manifest.engineType === 'translator') {
      ctx.pipeline.registerTranslator(manifest.engineId, factory as unknown as () => TranslatorEngine)
    } else if (manifest.engineType === 'e2e') {
      ctx.pipeline.registerE2E(manifest.engineId, factory as unknown as () => E2ETranslationEngine)
    }
    log.info(`Registered ${manifest.engineType} plugin: ${manifest.name} (${manifest.engineId})`)
  }

  // Forward results to subtitle window and logger
  ctx.pipeline.on('result', (result: TranslationResult) => {
    ctx.subtitleWindow?.webContents.send('translation-result', result)
    ctx.mainWindow?.webContents.send('translation-result', result)
    ctx.logger?.log(result)
  })

  // Forward interim (streaming) results to subtitle window
  ctx.pipeline.on('interim-result', (result: TranslationResult) => {
    ctx.subtitleWindow?.webContents.send('interim-result', result)
    ctx.mainWindow?.webContents.send('interim-result', result)
  })

  // Forward draft results from hybrid translation (#235)
  ctx.pipeline.on('draft-result', (result: TranslationResult) => {
    ctx.subtitleWindow?.webContents.send('draft-result', result)
    ctx.mainWindow?.webContents.send('draft-result', result)
  })

  ctx.pipeline.on('error', (err: Error) => {
    const msg = sanitizeErrorMessage(err.message)
    const hint = getErrorHint(msg)
    ctx.mainWindow?.webContents.send('status-update', `Error: ${msg}${hint}`)
  })

  ctx.pipeline.on('engine-loading', (msg: string) => {
    ctx.mainWindow?.webContents.send('status-update', msg)
  })

  ctx.pipeline.on('engine-ready', () => {
    ctx.mainWindow?.webContents.send('status-update', 'Engine ready')
  })
}

// --- Register all IPC handlers ---
registerAudioHandlers(ctx)
registerIpcHandlers(ctx)

// --- App Lifecycle ---

app.whenReady().then(() => {
  initPipeline()
  createMainWindow(ctx)
  createSubtitleWindow(ctx)
  registerDisplayHandlers(ctx)
})

let isQuitting = false
app.on('before-quit', (event) => {
  if (isQuitting) return
  isQuitting = true
  event.preventDefault()

  // Async cleanup before quit — timeout after 5s to prevent hanging (#222)
  ;(async () => {
    try {
      ctx.logger?.endSession()
      ctx.logger = null
      store.set('activeSession', null)
      await Promise.race([
        Promise.all([
          ctx.pipeline?.dispose() ?? Promise.resolve(),
          ctx.wsAudioServer?.stop() ?? Promise.resolve()
        ]),
        new Promise((_resolve, reject) =>
          setTimeout(() => reject(new Error('Cleanup timed out')), 5000)
        )
      ])
    } catch (err) {
      log.error('Cleanup error:', err)
    } finally {
      app.quit()
    }
  })()
})

app.on('window-all-closed', () => {
  app.quit()
})
