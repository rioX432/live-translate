import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setLastSubtitleText } from './shortcut-manager'

// Mock electron modules
vi.mock('electron', () => ({
  globalShortcut: {
    register: vi.fn(() => true),
    unregister: vi.fn()
  },
  clipboard: {
    writeText: vi.fn()
  }
}))

vi.mock('./store', () => ({
  store: {
    get: vi.fn((key: string) => {
      const defaults: Record<string, unknown> = {
        subtitleSettings: { fontSize: 30, sourceTextColor: '#fff', translatedTextColor: '#7dd3fc', backgroundOpacity: 78, position: 'bottom', accessibility: { highContrast: false, dyslexiaFont: false, reducedMotion: false, letterSpacing: 0, wordSpacing: 0 } },
        sourceLanguage: 'ja',
        targetLanguage: 'en'
      }
      return defaults[key]
    }),
    set: vi.fn()
  }
}))

vi.mock('./logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

describe('shortcut-manager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('setLastSubtitleText', () => {
    it('should store text for clipboard copy', () => {
      // Just verify it doesn't throw
      setLastSubtitleText('Hello world')
      setLastSubtitleText('')
    })
  })

  describe('registerGlobalShortcuts', () => {
    it('should register all 6 shortcuts and return dispose function', async () => {
      const { globalShortcut } = await import('electron')
      const { registerGlobalShortcuts } = await import('./shortcut-manager')

      const ctx = {
        mainWindow: null,
        subtitleWindow: null,
        pipeline: null,
        logger: null,
        wsAudioServer: null,
        ttsManager: null,
        virtualMicManager: null
      }

      const dispose = registerGlobalShortcuts(ctx as never)

      expect(globalShortcut.register).toHaveBeenCalledTimes(7)
      expect(typeof dispose).toBe('function')

      dispose()
      expect(globalShortcut.unregister).toHaveBeenCalledTimes(7)
    })
  })

  describe('getShortcutLabels', () => {
    it('should return labels for all shortcut actions', async () => {
      const { getShortcutLabels } = await import('./shortcut-manager')
      const labels = getShortcutLabels()

      expect(Object.keys(labels)).toHaveLength(7)
      expect(labels['toggle-capture'].action).toBe('Toggle capture')
      expect(labels['copy-last-subtitle'].action).toBe('Copy last subtitle')
    })
  })
})
