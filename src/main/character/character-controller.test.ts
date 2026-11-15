import { EventEmitter } from 'events'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { defaultCharacterSettings } from '../../shared/character/settings'
import type { TranslationPipeline } from '../../pipeline/TranslationPipeline'

const windows: FakeWindow[] = []

class FakeWindow {
  visible = false
  destroyed = false
  bounds = { x: 0, y: 0, width: 0, height: 0 }
  setIgnoreMouseEvents = vi.fn()
  showInactive = vi.fn(() => {
    this.visible = true
  })
  hide = vi.fn(() => {
    this.visible = false
  })
  webContents = { getURL: () => 'file:///index.html#/character', send: vi.fn() }
  constructor(options: { x: number; y: number; width: number; height: number }) {
    this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height }
    windows.push(this)
  }
  setBounds(b: FakeWindow['bounds']): void {
    this.bounds = b
  }
  getBounds(): FakeWindow['bounds'] {
    return this.bounds
  }
  isVisible(): boolean {
    return this.visible
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  destroy(): void {
    this.destroyed = true
  }
  once(): void {}
  on(): void {}
  loadFile(): void {}
  loadURL(): void {}
}

const display = { id: 1, workArea: { x: 0, y: 0, width: 1512, height: 949 }, scaleFactor: 2 }

vi.mock('electron', () => ({
  BrowserWindow: FakeWindow,
  screen: {
    getAllDisplays: () => [display],
    getPrimaryDisplay: () => display,
    getDisplayMatching: () => display,
    on: vi.fn(),
    removeListener: vi.fn()
  }
}))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))
vi.mock('../window-manager', () => ({ applyOverlayWindowLevel: vi.fn(), OVERLAY_PLATFORM_OPTIONS: {} }))
vi.mock('../store', () => ({ store: { get: vi.fn(), onDidChange: vi.fn(() => () => {}) } }))
vi.mock('../logger', () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }))
vi.mock('./character-store', () => ({
  loadCharacterSettings: () => defaultCharacterSettings(),
  writeCharacterSettings: (s: unknown) => s
}))

const { CharacterController } = await import('./character-controller')

describe('CharacterController', () => {
  let controller: InstanceType<typeof CharacterController>
  let pipeline: EventEmitter

  beforeEach(() => {
    vi.useFakeTimers()
    windows.length = 0
    controller = new CharacterController(() => null, () => null)
    controller.start()
    pipeline = new EventEmitter()
    controller.attachPipeline(pipeline as unknown as TranslationPipeline)
  })

  afterEach(() => {
    controller.dispose()
    vi.useRealTimers()
  })

  it('switches to meeting mode when recording starts and back to standby when it stops', () => {
    expect(controller.getStatus().mode).toBe('standby')
    pipeline.emit('state-change', 'running')
    expect(controller.getStatus()).toEqual({ state: 'listening', mode: 'meeting' })
    pipeline.emit('state-change', 'idle')
    expect(controller.getStatus().mode).toBe('standby')
  })

  it('reacts to pipeline events with the matching state', () => {
    pipeline.emit('state-change', 'running')
    pipeline.emit('interim-result')
    expect(controller.getStatus().state).toBe('translating')
    pipeline.emit('result', { confidence: 0.2 })
    expect(controller.getStatus().state).toBe('uncertain')
    pipeline.emit('error')
    expect(controller.getStatus().state).toBe('error')
  })

  it('lets the pointer reach the character only outside meetings', () => {
    const win = windows[0]
    controller.setInteractive(true)
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })

    pipeline.emit('state-change', 'running')
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })

    controller.setInteractive(true)
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true })

    pipeline.emit('state-change', 'idle')
    controller.setInteractive(true)
    expect(win.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false, { forward: true })
  })

  it('hides the window during meetings when set to hide, and shows it again after', () => {
    const settings = defaultCharacterSettings()
    controller.updateSettings({ ...settings, display: { ...settings.display, inMeeting: 'hidden' } })
    const win = windows[0]
    win.visible = true
    pipeline.emit('state-change', 'running')
    expect(win.isVisible()).toBe(false)
    pipeline.emit('state-change', 'idle')
    expect(win.showInactive).toHaveBeenCalled()
    expect(win.isVisible()).toBe(true)
  })
})
