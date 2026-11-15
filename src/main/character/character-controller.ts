import { BrowserWindow, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { createLogger } from '../logger'
import {
  INITIAL_CHARACTER_MACHINE,
  reduceCharacter,
  characterStatus,
  ACTIVITY_TIMEOUT_MS,
  IDLE_SLEEP_MS,
  TRANSIENT_DURATION_MS,
  LOW_CONFIDENCE_THRESHOLD,
  type CharacterEvent,
  type CharacterMachine,
  type PipelineStateName
} from '../../shared/character/state-machine'
import { anchorOf, characterWindowSize, placeCharacter, type Rect } from '../../shared/character/layout'
import type { CharacterSettings, CharacterStatus } from '../../shared/character/types'
import { loadCharacterSettings, writeCharacterSettings } from './character-store'
import { applyOverlayWindowLevel, OVERLAY_PLATFORM_OPTIONS } from '../window-manager'
import { store } from '../store'
import type { TranslationPipeline } from '../../pipeline/TranslationPipeline'
import type { TranslationResult } from '../../engines/types'

const log = createLogger('character')

/**
 * Owns the desktop character: its state machine, its window, and its timers.
 * One instance per app; the window is created only while the character is
 * enabled so a disabled character costs no renderer process.
 */
export class CharacterController {
  private machine: CharacterMachine = INITIAL_CHARACTER_MACHINE
  private settings: CharacterSettings = loadCharacterSettings()
  private window: BrowserWindow | null = null
  private lastStatus: CharacterStatus = characterStatus(INITIAL_CHARACTER_MACHINE)
  private transientTimer: NodeJS.Timeout | null = null
  private activityTimer: NodeJS.Timeout | null = null
  private idleTimer: NodeJS.Timeout | null = null
  /** Display the user last dragged the character to; null follows the subtitle display */
  private displayId: number | null = null
  private interactive = false
  private disposed = false
  private unsubscribeAccessibility: (() => void) | null = null

  constructor(
    private readonly getMainWindow: () => BrowserWindow | null,
    private readonly getSubtitleWindow: () => BrowserWindow | null
  ) {}

  start(): void {
    this.syncWindow()
    this.armIdleTimer()
    screen.on('display-removed', this.onDisplaysChanged)
    screen.on('display-metrics-changed', this.onDisplaysChanged)
    this.unsubscribeAccessibility = store.onDidChange('subtitleSettings', () => {
      this.broadcast('character-app-reduced-motion', this.getAppReducedMotion())
    })
  }

  dispose(): void {
    this.disposed = true
    for (const t of [this.transientTimer, this.activityTimer, this.idleTimer]) if (t) clearTimeout(t)
    screen.removeListener('display-removed', this.onDisplaysChanged)
    screen.removeListener('display-metrics-changed', this.onDisplaysChanged)
    this.unsubscribeAccessibility?.()
    this.unsubscribeAccessibility = null
    this.destroyWindow()
  }

  getSettings(): CharacterSettings {
    return this.settings
  }

  getStatus(): CharacterStatus {
    return this.lastStatus
  }

  /** The app-wide accessibility "reduce motion" setting, stored with the subtitle settings */
  getAppReducedMotion(): boolean {
    return store.get('subtitleSettings')?.accessibility?.reducedMotion === true
  }

  /** Persist and apply new settings, then tell every window */
  updateSettings(next: CharacterSettings): CharacterSettings {
    this.settings = writeCharacterSettings(next)
    this.broadcast('character-settings-changed', this.settings)
    this.syncWindow()
    return this.settings
  }

  /** Subscribe to the current pipeline; call again after the pipeline is recreated */
  attachPipeline(pipeline: TranslationPipeline): void {
    pipeline.on('state-change', (state) => this.dispatch({ type: 'pipeline-state', state: state as PipelineStateName }))
    pipeline.on('engine-loading', () => this.dispatch({ type: 'engine-loading' }))
    pipeline.on('engine-ready', () => this.dispatch({ type: 'engine-ready' }))
    pipeline.on('interim-result', () => this.dispatch({ type: 'speech-activity' }))
    pipeline.on('draft-stt-result', () => this.dispatch({ type: 'speech-activity' }))
    pipeline.on('result', (result: TranslationResult) => {
      const low = typeof result.confidence === 'number' && result.confidence < LOW_CONFIDENCE_THRESHOLD
      this.dispatch({ type: 'translation-result', lowConfidence: low })
    })
    pipeline.on('error', () => this.dispatch({ type: 'error' }))
  }

  dispatch(event: CharacterEvent): void {
    if (this.disposed) return
    const prevMode = this.lastStatus.mode
    this.machine = reduceCharacter(this.machine, event)
    this.scheduleTimers(event)
    const status = characterStatus(this.machine)
    if (status.state === this.lastStatus.state && status.mode === this.lastStatus.mode) return
    this.lastStatus = status
    this.broadcast('character-status', status)
    if (status.mode !== prevMode) {
      log.info(`Mode: ${status.mode}`)
      if (status.mode === 'meeting') this.setInteractive(false)
      this.syncWindow()
    }
  }

  // --- overlay interaction ---

  setInteractive(interactive: boolean): void {
    // A click on any window of this app activates it, panel or not, which
    // takes focus from a full-screen meeting app, so meetings stay click-through
    const on = interactive && this.lastStatus.mode !== 'meeting'
    this.interactive = on
    // forward keeps hover events flowing so the overlay can turn this back on
    this.window?.setIgnoreMouseEvents(!on, { forward: true })
  }

  moveBy(dx: number, dy: number): void {
    if (!this.window || !this.interactive) return
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) return
    const [x, y] = this.window.getPosition()
    this.window.setPosition(Math.round(x + dx), Math.round(y + dy))
  }

  /** Save where the user dropped the character, keyed by the display it landed on */
  dragEnd(): void {
    if (!this.window) return
    const bounds = this.window.getBounds()
    const display = screen.getDisplayMatching(bounds)
    this.displayId = display.id
    const positionByDisplay = { ...this.settings.display.positionByDisplay, [String(display.id)]: anchorOf(bounds) }
    this.updateSettings({ ...this.settings, display: { ...this.settings.display, positionByDisplay } })
  }

  resetPosition(): CharacterSettings {
    const display = this.targetDisplay()
    const positionByDisplay = { ...this.settings.display.positionByDisplay }
    delete positionByDisplay[String(display.id)]
    return this.updateSettings({ ...this.settings, display: { ...this.settings.display, positionByDisplay } })
  }

  // --- internals ---

  private readonly onDisplaysChanged = (): void => this.syncWindow()

  private scheduleTimers(event: CharacterEvent): void {
    if (this.machine.transient && (event.type === 'error' || event.type === 'term-learned' || event.type === 'translation-result')) {
      if (this.transientTimer) clearTimeout(this.transientTimer)
      this.transientTimer = setTimeout(() => {
        this.transientTimer = null
        this.dispatch({ type: 'transient-expired' })
      }, TRANSIENT_DURATION_MS[this.machine.transient])
    }
    if (event.type === 'speech-activity' && this.machine.translating) {
      if (this.activityTimer) clearTimeout(this.activityTimer)
      this.activityTimer = setTimeout(() => {
        this.activityTimer = null
        this.dispatch({ type: 'activity-expired' })
      }, ACTIVITY_TIMEOUT_MS)
    }
    if (event.type !== 'idle-timeout' && event.type !== 'transient-expired' && event.type !== 'activity-expired') {
      this.armIdleTimer()
    }
  }

  private armIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = setTimeout(() => {
      this.idleTimer = null
      this.dispatch({ type: 'idle-timeout' })
    }, IDLE_SLEEP_MS)
  }

  private broadcast(channel: string, payload: unknown): void {
    for (const win of [this.window, this.getMainWindow()]) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    }
  }

  private targetDisplay(): Electron.Display {
    const displays = screen.getAllDisplays()
    const chosen = this.displayId !== null ? displays.find((d) => d.id === this.displayId) : undefined
    if (chosen) return chosen
    const subtitle = this.getSubtitleWindow()
    if (subtitle && !subtitle.isDestroyed()) return screen.getDisplayMatching(subtitle.getBounds())
    return screen.getPrimaryDisplay()
  }

  private computeBounds(): Rect {
    const display = this.targetDisplay()
    const subtitle = this.getSubtitleWindow()
    return placeCharacter({
      workArea: display.workArea,
      size: characterWindowSize(this.settings.display, this.lastStatus.mode),
      saved: this.settings.display.positionByDisplay[String(display.id)],
      subtitle: subtitle && !subtitle.isDestroyed() && subtitle.isVisible() ? subtitle.getBounds() : null,
      mode: this.lastStatus.mode
    })
  }

  /** Create, move, show, hide, or destroy the window to match settings and mode */
  private syncWindow(): void {
    if (this.disposed) return
    const { visible, inMeeting } = this.settings.display
    if (!visible) {
      this.destroyWindow()
      return
    }
    const bounds = this.computeBounds()
    if (!this.window) this.createWindow(bounds)
    const win = this.window
    if (!win) return
    win.setBounds(bounds)
    const hideForMeeting = this.lastStatus.mode === 'meeting' && inMeeting === 'hidden'
    if (hideForMeeting) {
      win.hide()
    } else if (!win.isVisible() && win.webContents.getURL()) {
      // showInactive keeps keyboard focus in the meeting app
      win.showInactive()
    }
  }

  private createWindow(bounds: Rect): void {
    const win = new BrowserWindow({
      ...bounds,
      show: false,
      transparent: true,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      // The character must never take focus from the meeting app
      focusable: false,
      ...OVERLAY_PLATFORM_OPTIONS,
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })
    applyOverlayWindowLevel(win)
    win.setIgnoreMouseEvents(true, { forward: true })
    this.interactive = false

    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      const hidden = this.lastStatus.mode === 'meeting' && this.settings.display.inMeeting === 'hidden'
      if (!hidden) win.showInactive()
    })
    win.on('closed', () => {
      if (this.window === win) this.window = null
    })

    if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#/character`)
    } else {
      win.loadFile(join(__dirname, '../renderer/index.html'), { hash: '/character' })
    }
    this.window = win
  }

  private destroyWindow(): void {
    const win = this.window
    this.window = null
    if (win && !win.isDestroyed()) win.destroy()
  }

  /** Identifies the character overlay as an IPC sender */
  isCharacterWindow(contents: Electron.WebContents): boolean {
    return !!this.window && !this.window.isDestroyed() && this.window.webContents === contents
  }
}
