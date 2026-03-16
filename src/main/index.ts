import { app, BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { TranslationPipeline } from '../pipeline/TranslationPipeline'
import { WhisperLocalEngine } from '../engines/stt/WhisperLocalEngine'
import { GoogleTranslator } from '../engines/translator/GoogleTranslator'
import { WhisperTranslateEngine } from '../engines/e2e/WhisperTranslateEngine'
import { TranscriptLogger } from '../logger/TranscriptLogger'
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
  // GoogleTranslator needs API key — registered dynamically when user provides one

  // Register E2E engines
  pipeline.registerE2E('whisper-translate', () => new WhisperTranslateEngine())

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
ipcMain.handle('pipeline-start', async (_event, config: EngineConfig & { apiKey?: string }) => {
  if (!pipeline) return { error: 'Pipeline not initialized' }

  try {
    // Register Google Translator with provided API key
    if (config.apiKey) {
      pipeline.registerTranslator('google-translate', () => new GoogleTranslator(config.apiKey!))
    }

    await pipeline.switchEngine(config)

    // Start logger
    logger = new TranscriptLogger()
    logger.startSession(config.mode === 'cascade' ? 'Online (Whisper + Google)' : 'Offline (Whisper Translate)')

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

// Process audio chunk from renderer
ipcMain.handle('process-audio', async (_event, audioData: ArrayBuffer) => {
  if (!pipeline?.running) return null
  const chunk = new Float32Array(audioData)
  return await pipeline.process(chunk, 16000)
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
