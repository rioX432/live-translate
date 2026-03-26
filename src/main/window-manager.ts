import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { store } from './store'
import type { AppContext } from './app-context'

/** Calculate subtitle window height based on display scale factor */
export function getSubtitleHeight(display: Electron.Display): number {
  // Base height for 3 subtitle lines at default font size (30px)
  const baseHeight = 200
  const scaleFactor = display.scaleFactor ?? 1
  // Scale for HiDPI displays but cap at 2x to avoid excessively tall windows
  return Math.round(baseHeight * Math.min(scaleFactor, 2))
}

export function createMainWindow(ctx: AppContext): void {
  ctx.mainWindow = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 480,
    minHeight: 600,
    resizable: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    ctx.mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    ctx.mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  ctx.mainWindow.on('closed', () => {
    ctx.mainWindow = null
    ctx.subtitleWindow?.close()
  })
}

export function createSubtitleWindow(ctx: AppContext): void {
  const displays = screen.getAllDisplays()
  const savedDisplayId = store.get('selectedDisplay')
  const savedDisplay = savedDisplayId ? displays.find((d) => d.id === savedDisplayId) : null
  const primaryId = screen.getPrimaryDisplay().id
  const externalDisplay = displays.find((d) => d.id !== primaryId)
  const targetDisplay = savedDisplay || externalDisplay || displays[0]

  const subtitleHeight = getSubtitleHeight(targetDisplay)
  ctx.subtitleWindow = new BrowserWindow({
    x: targetDisplay.bounds.x,
    y: targetDisplay.bounds.y + targetDisplay.bounds.height - subtitleHeight,
    width: targetDisplay.bounds.width,
    height: subtitleHeight,
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

  ctx.subtitleWindow.setIgnoreMouseEvents(true, { forward: true })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    ctx.subtitleWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/subtitle`)
  } else {
    ctx.subtitleWindow.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/subtitle' })
  }

  ctx.subtitleWindow.on('closed', () => {
    ctx.subtitleWindow = null
  })
}

/** Register display-change event handlers. Returns a cleanup function that removes the listeners. */
export function registerDisplayHandlers(ctx: AppContext): () => void {
  // #46: reposition subtitle window when external display is disconnected
  const onDisplayRemoved = (): void => {
    if (!ctx.subtitleWindow) return
    const primaryDisplay = screen.getPrimaryDisplay()
    const h = getSubtitleHeight(primaryDisplay)
    ctx.subtitleWindow.setBounds({
      x: primaryDisplay.bounds.x,
      y: primaryDisplay.bounds.y + primaryDisplay.bounds.height - h,
      width: primaryDisplay.bounds.width,
      height: h
    })
    // #64: notify renderer to refresh display list
    ctx.mainWindow?.webContents.send('displays-changed')
  }

  const onDisplayAdded = (): void => {
    ctx.mainWindow?.webContents.send('displays-changed')
  }

  screen.on('display-removed', onDisplayRemoved)
  screen.on('display-added', onDisplayAdded)

  return () => {
    screen.removeListener('display-removed', onDisplayRemoved)
    screen.removeListener('display-added', onDisplayAdded)
  }
}
