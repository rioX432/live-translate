import { app, BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { TranslationPipeline } from '../pipeline/TranslationPipeline'
import { WhisperLocalEngine } from '../engines/stt/WhisperLocalEngine'
import { GoogleTranslator } from '../engines/translator/GoogleTranslator'
import { DeepLTranslator } from '../engines/translator/DeepLTranslator'
import { GeminiTranslator } from '../engines/translator/GeminiTranslator'
import { MicrosoftTranslator } from '../engines/translator/MicrosoftTranslator'
import { OpusMTTranslator } from '../engines/translator/OpusMTTranslator'
import { ApiRotationController } from '../engines/translator/ApiRotationController'
import type { ProviderConfig, QuotaStore } from '../engines/translator/ApiRotationController'
import { WhisperTranslateEngine } from '../engines/e2e/WhisperTranslateEngine'
import { TranscriptLogger } from '../logger/TranscriptLogger'
import { store } from './store'
import type { EngineConfig, TranslationResult } from '../engines/types'

let mainWindow: BrowserWindow | null = null
let subtitleWindow: BrowserWindow | null = null
let pipeline: TranslationPipeline | null = null
let logger: TranscriptLogger | null = null

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    subtitleWindow?.close()
  })
}

function createSubtitleWindow(): void {
  const displays = screen.getAllDisplays()
  const externalDisplay = displays.find((d) => d.bounds.x !== 0 || d.bounds.y !== 0)
  const targetDisplay = externalDisplay || displays[0]

  subtitleWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y + targetDisplay.bounds.height - 200,
    width: targetDisplay.bounds.width,
    height: 200,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  subtitleWindow.setIgnoreMouseEvents(true, { forward: true })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    subtitleWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/subtitle`)
  } else {
    subtitleWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/subtitle' })
  }

  subtitleWindow.on('closed', () => {
    subtitleWindow = null
  })
}

function initPipeline(): void {
  pipeline = new TranslationPipeline()

  // Register STT engines
  pipeline.registerSTT('whisper-local', () => new WhisperLocalEngine({
    onProgress: (msg) => mainWindow?.webContents.send('status-update', msg)
  }))

  // Register translator engines
  pipeline.registerTranslator('opus-mt', () => new OpusMTTranslator({
    onProgress: (msg) => mainWindow?.webContents.send('status-update', msg)
  }))
  // GoogleTranslator needs API key — registered dynamically when user provides one

  // Register E2E engines
  pipeline.registerE2E('whisper-translate', () => new WhisperTranslateEngine({
    onProgress: (msg) => mainWindow?.webContents.send('status-update', msg)
  }))

  // Forward results to subtitle window and logger
  pipeline.on('result', (result: TranslationResult) => {
    subtitleWindow?.webContents.send('translation-result', result)
    mainWindow?.webContents.send('translation-result', result)
    logger?.log(result)
  })

  pipeline.on('error', (err: Error) => {
    mainWindow?.webContents.send('status-update', `Error: ${err.message}`)
  })

  pipeline.on('engine-loading', (msg: string) => {
    mainWindow?.webContents.send('status-update', msg)
  })

  pipeline.on('engine-ready', () => {
    mainWindow?.webContents.send('status-update', 'Engine ready')
  })
}

// --- IPC Handlers ---

// Start pipeline with given config
interface PipelineStartConfig extends EngineConfig {
  apiKey?: string
  deeplApiKey?: string
  geminiApiKey?: string
  microsoftApiKey?: string
  microsoftRegion?: string
}

ipcMain.handle('pipeline-start', async (_event, config: PipelineStartConfig) => {
  if (!pipeline) return { error: 'Pipeline not initialized' }

  try {
    // Register online translators with provided API keys
    if (config.apiKey) {
      pipeline.registerTranslator('google-translate', () => new GoogleTranslator(config.apiKey!))
    }
    if (config.deeplApiKey) {
      pipeline.registerTranslator('deepl-translate', () => new DeepLTranslator(config.deeplApiKey!))
    }
    if (config.geminiApiKey) {
      pipeline.registerTranslator('gemini-translate', () => new GeminiTranslator(config.geminiApiKey!))
    }
    if (config.microsoftApiKey && config.microsoftRegion) {
      pipeline.registerTranslator('microsoft-translate', () =>
        new MicrosoftTranslator(config.microsoftApiKey!, config.microsoftRegion!)
      )
    }

    // Build rotation controller when rotation mode is selected
    if (config.translatorEngineId === 'rotation-controller') {
      const providers: ProviderConfig[] = []
      const statusFn = (msg: string): void => {
        mainWindow?.webContents.send('status-update', msg)
      }

      // Order: Azure (2M) → Google (480K safe cap) → DeepL (500K)
      if (config.microsoftApiKey && config.microsoftRegion) {
        providers.push({
          engine: new MicrosoftTranslator(config.microsoftApiKey, config.microsoftRegion),
          monthlyCharLimit: 2_000_000
        })
      }
      if (config.apiKey) {
        providers.push({
          engine: new GoogleTranslator(config.apiKey),
          monthlyCharLimit: 480_000
        })
      }
      if (config.deeplApiKey) {
        providers.push({
          engine: new DeepLTranslator(config.deeplApiKey),
          monthlyCharLimit: 500_000
        })
      }

      if (providers.length === 0) {
        return { error: 'Rotation mode requires at least one API key' }
      }

      const persistence = {
        load: (): QuotaStore => store.get('quotaTracking') as QuotaStore,
        save: (quota: QuotaStore): void => { store.set('quotaTracking', quota) }
      }

      pipeline.registerTranslator('rotation-controller', () =>
        new ApiRotationController(providers, persistence, statusFn)
      )
    }

    await pipeline.switchEngine(config)

    // Start logger
    logger = new TranscriptLogger()
    const sessionLabel = config.mode === 'e2e'
      ? 'Offline (Whisper Translate)'
      : `Cascade (Whisper + ${config.translatorEngineId})`
    logger.startSession(sessionLabel)

    pipeline.start()
    return { success: true }
  } catch (err) {
    return { error: String(err) }
  }
})

// Stop pipeline
ipcMain.handle('pipeline-stop', async () => {
  pipeline?.stop()
  logger?.endSession()
  const logPath = logger?.getLogPath()
  logger = null
  return { logPath }
})

// Get session start time
ipcMain.handle('get-session-start-time', () => {
  return pipeline?.sessionStartTime ?? null
})

// Process audio chunk from renderer
ipcMain.handle('process-audio', async (_event, audioData: unknown) => {
  if (!pipeline?.running) return null

  let chunk: Float32Array
  if (audioData instanceof Float32Array) {
    chunk = audioData
  } else if (Array.isArray(audioData)) {
    chunk = new Float32Array(audioData)
  } else if (audioData instanceof ArrayBuffer || Buffer.isBuffer(audioData)) {
    chunk = new Float32Array(
      Buffer.isBuffer(audioData) ? audioData.buffer.slice(audioData.byteOffset, audioData.byteOffset + audioData.byteLength) : audioData
    )
  } else {
    console.error('[audio] Unknown data type:', typeof audioData)
    return null
  }

  // Minimum audio length check (at least 0.5 seconds at 16kHz)
  if (chunk.length < 8000) {
    console.log(`[audio] Chunk too short: ${chunk.length} samples, skipping`)
    return null
  }

  // Debug: log audio stats (scan all samples)
  let maxAmp = 0
  for (let i = 0; i < chunk.length; i++) {
    const abs = Math.abs(chunk[i])
    if (abs > maxAmp) maxAmp = abs
  }
  console.log(`[audio] samples=${chunk.length}, max_amplitude=${maxAmp.toFixed(6)}`)

  if (maxAmp < 0.001) {
    console.log('[audio] Silent chunk, skipping')
    return null
  }

  try {
    return await pipeline.process(chunk, 16000)
  } catch (err) {
    console.error('[audio] Pipeline error:', err)
    return null
  }
})

// Get available displays
ipcMain.handle('get-displays', () => {
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: i === 0 ? `Display ${i + 1} (Main)` : `Display ${i + 1} (External)`,
    bounds: d.bounds
  }))
})

// Move subtitle window to target display
ipcMain.on('move-subtitle-to-display', (_event, displayId: number) => {
  const display = screen.getAllDisplays().find((d) => d.id === displayId)
  if (display && subtitleWindow) {
    subtitleWindow.setBounds({
      x: display.bounds.x,
      y: display.bounds.y + display.bounds.height - 200,
      width: display.bounds.width,
      height: 200
    })
  }
})

// Forward translation result to subtitle window (from renderer)
ipcMain.on('translation-result', (_event, data) => {
  subtitleWindow?.webContents.send('translation-result', data)
})

// --- App Lifecycle ---

app.whenReady().then(() => {
  initPipeline()
  createMainWindow()
  createSubtitleWindow()
})

app.on('window-all-closed', () => {
  pipeline?.dispose()
  app.quit()
})
