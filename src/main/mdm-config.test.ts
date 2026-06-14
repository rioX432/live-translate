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

    it('returns null for all managed Microsoft fields', async () => {
      const { loadMdmConfig } = await import('./mdm-config')
      const cfg = loadMdmConfig()
      expect(cfg.managedMicrosoftApiKey).toBeNull()
      expect(cfg.managedMicrosoftRegion).toBeNull()
    })
  })

  describe('on macOS', () => {
    beforeEach(() => {
      setPlatform('darwin')
    })

    it('#704: loads managedMicrosoftApiKey + managedMicrosoftRegion from managed prefs', async () => {
      prefFixture = {
        managedMicrosoftApiKey: 'azure-secret-key-abc123',
        managedMicrosoftRegion: 'japaneast'
      }

      const { loadMdmConfig } = await import('./mdm-config')
      const cfg = loadMdmConfig()

      expect(cfg.managedMicrosoftApiKey).toBe('azure-secret-key-abc123')
      expect(cfg.managedMicrosoftRegion).toBe('japaneast')
    })

    it('#704: leaves Microsoft fields null when MDM does not set them', async () => {
      prefFixture = {
        managedApiKey: 'google-key',
        managedDeeplApiKey: 'deepl-key'
      }

      const { loadMdmConfig } = await import('./mdm-config')
      const cfg = loadMdmConfig()

      expect(cfg.managedApiKey).toBe('google-key')
      expect(cfg.managedDeeplApiKey).toBe('deepl-key')
      expect(cfg.managedMicrosoftApiKey).toBeNull()
      expect(cfg.managedMicrosoftRegion).toBeNull()
    })

    it('#704: caches config so repeat calls do not re-read prefs', async () => {
      prefFixture = { managedMicrosoftApiKey: 'first-key', managedMicrosoftRegion: 'eastus' }
      const { loadMdmConfig, getMdmConfig } = await import('./mdm-config')

      const a = loadMdmConfig()
      // Mutate fixture; cached config should not change because of caching
      prefFixture = { managedMicrosoftApiKey: 'second-key', managedMicrosoftRegion: 'westus' }
      const b = getMdmConfig()

      expect(a).toBe(b)
      expect(b.managedMicrosoftApiKey).toBe('first-key')
      expect(b.managedMicrosoftRegion).toBe('eastus')
    })
  })
})
