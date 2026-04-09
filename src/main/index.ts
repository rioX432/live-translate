import { app } from 'electron'
import { initMain as initAudioLoopback } from 'electron-audio-loopback'
import { TranslationPipeline } from '../pipeline/TranslationPipeline'
import { WhisperLocalEngine } from '../engines/stt/WhisperLocalEngine'
import { MlxWhisperEngine } from '../engines/stt/MlxWhisperEngine'
import { KotobaWhisperEngine } from '../engines/stt/KotobaWhisperEngine'
import { SenseVoiceEngine } from '../engines/stt/SenseVoiceEngine'
import { SherpaOnnxEngine } from '../engines/stt/SherpaOnnxEngine'
import { SenseVoiceSherpaEngine } from '../engines/stt/SenseVoiceSherpaEngine'
import { SpeechSwiftEngine } from '../engines/stt/SpeechSwiftEngine'
import { AppleSpeechTranscriberEngine } from '../engines/stt/AppleSpeechTranscriberEngine'
import { Qwen3ASREngine } from '../engines/stt/Qwen3ASREngine'
import { MoonshineTinyJaEngine } from '../engines/stt/MoonshineTinyJaEngine'
import { QwenAsrNativeEngine } from '../engines/stt/QwenAsrNativeEngine'
import { CarelessWhisperEngine } from '../engines/stt/CarelessWhisperEngine'
import { OnnxWebSTTEngine } from '../engines/stt/OnnxWebSTTEngine'
import { OpusMTTranslator } from '../engines/translator/OpusMTTranslator'
import { SLMTranslator } from '../engines/translator/SLMTranslator'
import { HunyuanMTTranslator } from '../engines/translator/HunyuanMTTranslator'
import { HunyuanMT15Translator } from '../engines/translator/HunyuanMT15Translator'
import { LFM2Translator } from '../engines/translator/LFM2Translator'
import { PLaMoTranslator } from '../engines/translator/PLaMoTranslator'
import { ANETranslator } from '../engines/translator/ANETranslator'
import { AppleTranslator } from '../engines/translator/AppleTranslator'
import { OnnxWebTranslator } from '../engines/translator/OnnxWebTranslator'
import { HybridTranslator } from '../engines/translator/HybridTranslator'
import { FluidAudioDiarizer } from '../engines/diarization/FluidAudioDiarizer'
import { discoverPlugins, loadPluginEngine } from '../engines/plugin-loader'
import { store } from './store'
import { sanitizeErrorMessage, getErrorHint } from './error-utils'
import { createMainWindow, createSubtitleWindow, registerDisplayHandlers } from './window-manager'
import { registerAudioHandlers } from './audio-handlers'
import { setupAudioPort } from './audio-port'
import { registerIpcHandlers } from './ipc-handlers'
import { createLogger } from './logger'
import { initAutoUpdater, registerUpdateHandlers, disposeAutoUpdater } from './auto-updater'
import { createAppContext } from './app-context'
import { registerGlobalShortcuts, setLastSubtitleText } from './shortcut-manager'
import { TTSManager } from './tts-manager'
import { VirtualMicManager } from './virtual-mic-manager'
import { loadMdmConfig } from './mdm-config'
import { trackTranslatedCharacters } from './ipc/pipeline-ipc'
import type { STTEngine, TranslatorEngine, E2ETranslationEngine, TranslationResult } from '../engines/types'
import type { WhisperVariant } from '../engines/model-downloader'

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
    // Kotoba-Whisper v2.0: JA-optimized MLX Whisper variant (JA CER 5.6%, JA-only output)
    ctx.pipeline.registerSTT('kotoba-whisper', () => new KotobaWhisperEngine({
      onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
    }))
  }
  // Experimental: requires Python funasr — not shown in default UI
  ctx.pipeline.registerSTT('sensevoice', () => new SenseVoiceEngine({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
  }))
  // Experimental: requires native addon — not shown in default UI
  ctx.pipeline.registerSTT('sherpa-onnx', () => new SherpaOnnxEngine({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
    modelKey: (store.get('sherpaOnnxModel') as string) || undefined
  }))
  // Experimental: SenseVoice Small via sherpa-onnx — ultra-fast CJK STT, no Python (#554)
  ctx.pipeline.registerSTT('sensevoice-sherpa', () => new SenseVoiceSherpaEngine({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
  }))
  // Qwen3-ASR 0.6B via speech-swift — Apple Silicon only, primary engine
  if (process.platform === 'darwin') {
    ctx.pipeline.registerSTT('qwen3-asr', () => new Qwen3ASREngine({
      onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
    }))
  }
  // Experimental: requires speech-swift binary (Homebrew) — Apple Silicon only, not shown in UI
  if (process.platform === 'darwin') {
    ctx.pipeline.registerSTT('speech-swift', () => new SpeechSwiftEngine({
      onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
    }))
  }
  // Apple SpeechTranscriber (macOS 26+) — primary on Tahoe, zero model management, ANE-native (#548)
  if (process.platform === 'darwin') {
    ctx.pipeline.registerSTT('apple-speech-transcriber', () => new AppleSpeechTranscriberEngine({
      onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
    }))
  }
  // Moonshine Tiny JA: ultra-fast draft STT for Japanese interim results (#536)
  // Not a primary engine — used as draft STT alongside the primary STT
  ctx.pipeline.registerSTT('moonshine-tiny-ja', () => new MoonshineTinyJaEngine({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
  }))
  // Experimental: Qwen3-ASR via antirez/qwen-asr pure C — cross-platform, no Python/Swift (#545)
  ctx.pipeline.registerSTT('qwen-asr-native', () => new QwenAsrNativeEngine({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
  }))
  // Experimental: CarelessWhisper — causal streaming Whisper via LoRA, <300ms chunks (#555)
  ctx.pipeline.registerSTT('careless-whisper', () => new CarelessWhisperEngine({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
    modelSize: (store.get('carelessWhisperModel') as string) || undefined,
    chunkSizeMs: (store.get('carelessWhisperChunkMs') as number) || undefined
  }))
  // Experimental: Whisper ONNX Web — WebGPU/WASM fallback STT (stub, #556)
  ctx.pipeline.registerSTT('onnx-web-stt', () => new OnnxWebSTTEngine())

  // Register translator engines
  // ONNX-based OPUS-MT — legacy fallback for low-memory systems and while downloading LLM models
  ctx.pipeline.registerTranslator('opus-mt', () => new OpusMTTranslator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
  }))
  // Experimental: TranslateGemma ~8s/sentence — too slow for real-time, kept for hybrid mode
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
  // LFM2-350M ultra-fast JA↔EN translator — 350M params, ~230MB
  ctx.pipeline.registerTranslator('lfm2', () => new LFM2Translator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
    kvCacheQuant: store.get('slmKvCacheQuant')
  }))
  // PLaMo-2-Translate 10B quality translator — Japan Gov "Gennai" adopted, ~5.5GB
  ctx.pipeline.registerTranslator('plamo', () => new PLaMoTranslator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
    kvCacheQuant: store.get('slmKvCacheQuant')
  }))
  // HY-MT1.5-1.8B — fast default offline translator (#544), replaces OPUS-MT
  ctx.pipeline.registerTranslator('hunyuan-mt-15', () => new HunyuanMT15Translator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
    kvCacheQuant: store.get('slmKvCacheQuant'),
    speculativeDecoding: store.get('slmSpeculativeDecoding')
  }))
  // ANEMLL Apple Neural Engine translator — macOS Apple Silicon only (#241) — experimental
  if (process.platform === 'darwin') {
    ctx.pipeline.registerTranslator('ane-translate', () => new ANETranslator({
      onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
    }))
  }
  // Apple Translation framework — macOS 15+ (Sequoia), zero-config, on-device (#557)
  if (process.platform === 'darwin') {
    ctx.pipeline.registerTranslator('apple-translate', () => new AppleTranslator({
      onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
    }))
  }
  // Experimental: NLLB-200 600M via ONNX Runtime Web — WebGPU/WASM fallback translator (#556)
  ctx.pipeline.registerTranslator('onnx-web', () => new OnnxWebTranslator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
  }))
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
  // Speculative decoding: LFM2-350M draft + HY-MT1.5-1.8B verifier (#518)
  // Token-level speculative decoding for 1.5-2x throughput improvement
  ctx.pipeline.registerTranslator('speculative-hybrid', () => new HunyuanMT15Translator({
    onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
    kvCacheQuant: store.get('slmKvCacheQuant'),
    speculativeDecoding: true
  }))
  // Register speaker diarizer — experimental, macOS only, requires FluidAudio (#549)
  if (process.platform === 'darwin') {
    ctx.pipeline.registerDiarizer('fluid-audio', () => new FluidAudioDiarizer({
      onProgress: (msg) => ctx.mainWindow?.webContents.send('status-update', msg)
    }))
  }

  // Apply diarization setting from store
  ctx.pipeline.setDiarizationEnabled(!!store.get('speakerDiarizationEnabled'))

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

  // Forward draft results from hybrid translation (#235)
  ctx.pipeline.on('draft-result', (result: TranslationResult) => {
    ctx.subtitleWindow?.webContents.send('draft-result', result)
    ctx.mainWindow?.webContents.send('draft-result', result)
  })

  // Forward draft STT interim results (#536)
  ctx.pipeline.on('draft-stt-result', (result: TranslationResult) => {
    ctx.subtitleWindow?.webContents.send('interim-result', result)
    ctx.mainWindow?.webContents.send('interim-result', result)
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
registerUpdateHandlers(ctx)

// --- Initialize electron-audio-loopback before app is ready ---
// Must be called before app.whenReady() per package documentation
initAudioLoopback()

// --- App Lifecycle ---

app.whenReady().then(async () => {
  // #519: Load MDM managed preferences early (before pipeline init)
  loadMdmConfig()

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

  // Set up MessagePort for zero-copy audio transfer after renderer loads (#553)
  if (ctx.mainWindow) {
    ctx.mainWindow.webContents.on('did-finish-load', () => {
      setupAudioPort(ctx)
    })
  }

  cleanupDisplayHandlers = registerDisplayHandlers(ctx)
  cleanupShortcuts = registerGlobalShortcuts(ctx)
  initAutoUpdater(ctx)
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
