import { app, protocol, net } from 'electron'
import { initMain as initAudioLoopback } from 'electron-audio-loopback'
import { TranslationPipeline } from '../pipeline/TranslationPipeline'
import { WhisperLocalEngine } from '../engines/stt/WhisperLocalEngine'
import { Qwen3ASREngine } from '../engines/stt/Qwen3ASREngine'
import { HyMT2Translator } from '../engines/translator/HyMT2Translator'
import { FluidAudioDiarizer } from '../engines/diarization/FluidAudioDiarizer'
import { discoverPlugins, loadPluginEngine } from '../engines/plugin-loader'
import { store } from './store'
import {
  migrateLegacyTranslationEngine,
  type MigratableKey
} from './store-migrations'
import { sanitizeErrorMessage, getErrorHint } from './error-utils'
import { createMainWindow, createSubtitleWindow, registerDisplayHandlers } from './window-manager'
import { registerAudioHandlers } from './audio-handlers'
import { registerIpcHandlers } from './ipc-handlers'
import { createLogger } from './logger'
import { initAutoUpdater, registerUpdateHandlers, disposeAutoUpdater } from './auto-updater'
import { createAppContext } from './app-context'
import { registerGlobalShortcuts, setLastSubtitleText } from './shortcut-manager'
import { TTSManager } from './tts-manager'
import { VirtualMicManager } from './virtual-mic-manager'
import { loadMdmConfig } from './mdm-config'
import { trackTranslatedCharacters } from './ipc/pipeline-ipc'
import { startOnboardingDownload, isTier1Ready } from './onboarding-downloader'
import type { STTEngine, TranslatorEngine, E2ETranslationEngine, TranslationResult } from '../engines/types'

const log = createLogger('main')

// Shared state — getter/setter backed so closures never hold stale references (#429)
const ctx = createAppContext()

async function initPipeline(): Promise<void> {
  // Remove all event listeners and dispose previous pipeline to prevent
  // listener accumulation on reinitialization (#383, #428)
  if (ctx.pipeline) {
    ctx.pipeline.removeAllListeners()
    await ctx.pipeline.dispose()
    ctx.pipeline = null
  }

  ctx.pipeline = new TranslationPipeline()

  const onProgress = (msg: string): void => { ctx.mainWindow?.webContents.send('status-update', msg) }
  // One engine per role; selectEngines() decides which of the two STT engines a platform uses.
  ctx.pipeline.registerSTT('whisper-local', () => new WhisperLocalEngine({ onProgress }))
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    ctx.pipeline.registerSTT('qwen3-asr', () => new Qwen3ASREngine({ onProgress }))
  }
  ctx.pipeline.registerTranslator('hy-mt2', () => new HyMT2Translator({ onProgress }))
  // Register speaker diarizer — experimental, macOS only, requires FluidAudio (#549)
  if (process.platform === 'darwin') {
    ctx.pipeline.registerDiarizer('fluid-audio', () => new FluidAudioDiarizer({
      onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
    }))
  }

  // Apply diarization setting from store
  ctx.pipeline.setDiarizationEnabled(!!store.get('speakerDiarizationEnabled'))

  // Plugins run with full system access, so packaged builds never auto-load them from userData.
  // Development builds still register them (#145).
  const discovered = app.isPackaged ? [] : discoverPlugins()
  if (app.isPackaged) log.info('Plugin auto-load disabled in packaged builds')
  for (const plugin of discovered) {
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
    // Track last subtitle for clipboard copy shortcut (#551)
    const subtitleParts = [result.sourceText, result.translatedText].filter(Boolean)
    if (subtitleParts.length > 0) setLastSubtitleText(subtitleParts.join('\n'))
    // #519: Track translated character count for usage analytics
    if (result.translatedText) {
      trackTranslatedCharacters(result.translatedText.length)
    }
    // TTS: synthesize translated text and send audio to renderer (#508)
    ctx.ttsManager?.handleTranslationResult(result, ctx.mainWindow).catch((err) => {
      log.error('TTS error:', err)
    })
  })

  // Forward interim (streaming) results to subtitle window
  ctx.pipeline.on('interim-result', (result: TranslationResult) => {
    ctx.subtitleWindow?.webContents.send('interim-result', result)
    ctx.mainWindow?.webContents.send('interim-result', result)
  })

  ctx.pipeline.on('segment-dropped', (segmentId: string) => {
    ctx.subtitleWindow?.webContents.send('segment-dropped', segmentId)
  })

  ctx.pipeline.on('state-change', (state: string) => {
    ctx.subtitleWindow?.webContents.send('pipeline-status', { state })
  })

  ctx.pipeline.on('error', (err: Error) => {
    const msg = sanitizeErrorMessage(err.message)
    const hint = getErrorHint(msg)
    ctx.mainWindow?.webContents.send('status-update', `Error: ${msg}${hint}`)
    ctx.subtitleWindow?.webContents.send('pipeline-status', { state: ctx.pipeline?.state ?? 'idle', error: msg })
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
registerUpdateHandlers(ctx)

// --- Register custom protocol for serving VAD assets outside asar ---
// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'vad-asset', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

// --- Initialize electron-audio-loopback before app is ready ---
// Must be called before app.whenReady() per package documentation
initAudioLoopback()

// --- App Lifecycle ---

app.whenReady().then(async () => {
  // Serve VAD assets (ONNX, WASM, worklet) from filesystem.
  // In packaged app, these are in app.asar.unpacked; dynamic import() can't read from asar.
  protocol.handle('vad-asset', (request) => {
    const filename = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '')
    const { join } = require('path')
    const vadDir = app.isPackaged
      ? join(process.resourcesPath, 'app.asar.unpacked', 'out', 'renderer', 'vad')
      : join(__dirname, '../renderer/vad')
    return net.fetch(`file://${join(vadDir, filename)}`)
  })

  // #519: Load MDM managed preferences early (before pipeline init)
  loadMdmConfig()

  // #575: Migration for existing users — if setup was already completed,
  // mark as not first run to avoid showing onboarding download banner
  if (store.get('hasCompletedSetup') && store.get('isFirstRun')) {
    store.set('isFirstRun', false)
    // Existing users keep their current engine (don't override to 'online')
    log.info('Existing user detected — skipping onboarding')
  }

  // #702 / #705: Migrate legacy persisted engine IDs trimmed from the UI.
  const migratableStore = {
    get: (key: MigratableKey) => store.get(key),
    set: (key: MigratableKey, value: string) => store.set(key, value)
  }
  migrateLegacyTranslationEngine(migratableStore, log)

  // #730: dev-only shadow measurement run. Builds its own engines, opens no
  // windows, and quits when the report is written — the production pipeline and
  // UI are never involved.
  if (process.env.LT_SHADOW_JA_EN === '1' && !app.isPackaged) {
    const { runShadowJaEnHarness } = await import('./dev/shadow-harness')
    try {
      await runShadowJaEnHarness({
        limit: process.env.LT_SHADOW_LIMIT ? Number(process.env.LT_SHADOW_LIMIT) : undefined,
        outPath: process.env.LT_SHADOW_OUT
      })
    } catch (err) {
      log.error('Shadow harness failed:', err)
      process.exitCode = 1
    }
    app.quit()
    return
  }

  await initPipeline()

  // Initialize TTS manager (#508)
  ctx.ttsManager = new TTSManager()
  const ttsEnabled = store.get('ttsEnabled')
  if (ttsEnabled) {
    ctx.ttsManager.setEnabled(true).catch((err) => {
      log.error('TTS auto-init failed:', err)
    })
  }
  const ttsVoice = store.get('ttsVoice')
  if (ttsVoice) ctx.ttsManager.setVoice(ttsVoice)
  ctx.ttsManager.setVolume(store.get('ttsVolume') ?? 0.8)

  // Initialize virtual mic manager (#515)
  ctx.virtualMicManager = new VirtualMicManager()
  await ctx.virtualMicManager.initialize()
  // Connect TTS → virtual mic routing
  ctx.ttsManager.setVirtualMicManager(ctx.virtualMicManager)
  // Restore virtual mic state from persisted settings
  const vmEnabled = store.get('virtualMicEnabled')
  const vmDeviceId = store.get('virtualMicDeviceId')
  if (vmEnabled && vmDeviceId >= 0 && ctx.virtualMicManager.isAvailable()) {
    ctx.virtualMicManager.enable(vmDeviceId).catch((err) => {
      log.error('Virtual mic auto-restore failed:', err)
    })
  }

  createMainWindow(ctx)
  createSubtitleWindow(ctx)

  cleanupDisplayHandlers = registerDisplayHandlers(ctx)
  cleanupShortcuts = registerGlobalShortcuts(ctx)
  initAutoUpdater(ctx)

  // #694: fetch the default engine models on first run so the first start works offline.
  if (store.get('isFirstRun') && !isTier1Ready()) {
    // Delay to avoid competing with app startup I/O
    setTimeout(() => {
      startOnboardingDownload(ctx.mainWindow).then((engineMode) => {
        if (engineMode) log.info(`Default models ready: ${engineMode}`)
      }).catch((err) => {
        log.error('Model download failed:', err)
      })
    }, 5000)
  }
})

let cleanupDisplayHandlers: (() => void) | null = null
let cleanupShortcuts: (() => void) | null = null
let isQuitting = false
app.on('before-quit', (event) => {
  if (isQuitting) return
  isQuitting = true
  event.preventDefault()

  // Async cleanup before quit — timeout after 5s to prevent hanging (#222)
  ;(async () => {
    try {
      cleanupDisplayHandlers?.()
      cleanupDisplayHandlers = null
      cleanupShortcuts?.()
      cleanupShortcuts = null
      disposeAutoUpdater()
      ctx.logger?.endSession()
      ctx.logger = null
      store.set('activeSession', null)
      await Promise.race([
        Promise.all([
          ctx.pipeline?.dispose() ?? Promise.resolve(),
          ctx.wsAudioServer?.stop() ?? Promise.resolve(),
          ctx.ttsManager?.dispose() ?? Promise.resolve(),
          ctx.virtualMicManager?.dispose() ?? Promise.resolve()
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
