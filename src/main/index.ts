import { app, BrowserWindow, screen, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'

let mainWindow: BrowserWindow | null = null
let subtitleWindow: BrowserWindow | null = null

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 600,
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
    subtitleWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: '/subtitle'
    })
  }

  subtitleWindow.on('closed', () => {
    subtitleWindow = null
  })
}

// IPC: Send translation results to subtitle window
ipcMain.on('translation-result', (_event, data) => {
  subtitleWindow?.webContents.send('translation-result', data)
})

// IPC: Get available displays
ipcMain.handle('get-displays', () => {
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: i === 0 ? `Display ${i + 1} (Main)` : `Display ${i + 1} (External)`,
    bounds: d.bounds
  }))
})

// IPC: Move subtitle window to target display
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

app.whenReady().then(() => {
  createMainWindow()
  createSubtitleWindow()
})

app.on('window-all-closed', () => {
  app.quit()
})
