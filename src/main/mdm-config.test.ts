import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Mock child_process.execSync so we can simulate macOS `defaults read` output
 * for managed preferences without touching the real filesystem.
 *
 * The real `readManagedPref` builds a command of the form
 *   defaults read "/Library/Managed Preferences/<bundle>" <key> 2>/dev/null
 * We capture the requested key from the command string and return a value
 * from the configured fixture map. Missing keys throw, matching the real
 * `defaults` behavior (which exits non-zero when a key is absent).
 */
let prefFixture: Record<string, string> = {}

vi.mock('child_process', () => ({
  execSync: vi.fn((cmd: string) => {
    // Extract the trailing key argument (after the quoted path).
    // Format: defaults read "<path>" <key> 2>/dev/null
    const match = cmd.match(/" ([A-Za-z0-9_]+) 2>\/dev\/null$/)
    const key = match?.[1]
    if (!key || !(key in prefFixture)) {
      throw new Error(`defaults: key "${key}" not found`)
    }
    return prefFixture[key]
  })
}))

vi.mock('./logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

const originalPlatform = process.platform

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

describe('mdm-config', () => {
  beforeEach(async () => {
    prefFixture = {}
    const mod = await import('./mdm-config')
    mod.clearMdmConfigCache()
  })

  afterEach(() => {
    setPlatform(originalPlatform)
  })

  describe('on non-macOS platforms', () => {
    beforeEach(() => {
      setPlatform('linux')
    })

    it('returns an unmanaged config', async () => {
      const { loadMdmConfig } = await import('./mdm-config')
      const cfg = loadMdmConfig()
      expect(cfg.lockedEngine).toBeNull()
      expect(cfg.organizationName).toBeNull()
    })
  })

  describe('on macOS', () => {
    beforeEach(() => {
      setPlatform('darwin')
    })

    it('loads locked engines from managed prefs', async () => {
      prefFixture = { lockedEngine: 'offline-hymt15', lockedSttEngine: 'whisper-local' }

      const { loadMdmConfig } = await import('./mdm-config')
      const cfg = loadMdmConfig()

      expect(cfg.lockedEngine).toBe('offline-hymt15')
      expect(cfg.lockedSttEngine).toBe('whisper-local')
    })

    it('never exposes API keys, even when an old profile still sets them', async () => {
      prefFixture = {
        managedApiKey: 'google-key',
        managedMicrosoftApiKey: 'azure-key',
        lockedEngine: 'auto'
      }

      const { loadMdmConfig } = await import('./mdm-config')
      const cfg = loadMdmConfig()

      expect(JSON.stringify(cfg)).not.toContain('google-key')
      expect(JSON.stringify(cfg)).not.toContain('azure-key')
    })

    it('caches config so repeat calls do not re-read prefs', async () => {
      prefFixture = { lockedEngine: 'first' }
      const { loadMdmConfig, getMdmConfig } = await import('./mdm-config')

      const a = loadMdmConfig()
      prefFixture = { lockedEngine: 'second' }
      const b = getMdmConfig()

      expect(a).toBe(b)
      expect(b.lockedEngine).toBe('first')
    })
  })
})
