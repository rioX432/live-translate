import { describe, it, expect, vi, beforeEach } from 'vitest'

const handlers = new Map<string, (event: unknown, arg?: unknown) => Promise<unknown>>()

vi.mock('electron', () => ({
  app: { getPath: () => '/tmp/live-translate-test' },
  ipcMain: {
    handle: (channel: string, fn: (event: unknown, arg?: unknown) => Promise<unknown>) => {
      handlers.set(channel, fn)
    }
  }
}))

// The real store.ts runs so the assertions cover the shipped defaults; only the
// electron-store backend and the Electron app path are replaced.
vi.mock('electron-store', () => ({
  default: class {
    data = new Map<string, unknown>()
    constructor(opts: { defaults: Record<string, unknown> }) {
      for (const [k, v] of Object.entries(opts.defaults)) this.data.set(k, v)
    }
    get(key: string): unknown {
      return this.data.get(key)
    }
    set(key: string, value: unknown): void {
      this.data.set(key, value)
    }
  }
}))
vi.mock('../legacy-store', () => ({ migrateLegacyStoreFile: vi.fn() }))

const startSession = vi.fn()
vi.mock('../../logger/TranscriptLogger', () => ({
  TranscriptLogger: class {
    startSession = startSession
    endSession = vi.fn()
    getLogPath = vi.fn()
  }
}))

vi.mock('../logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() })
}))
vi.mock('../mdm-config', () => ({ getMdmConfig: () => ({}) }))
vi.mock('../../logger/UsageAnalytics', () => ({ recordSessionEnd: vi.fn() }))
vi.mock('../error-utils', () => ({ sanitizeErrorMessage: (m: string) => m }))
vi.mock('../../engines/translator/glossary-manager', () => ({ mergeGlossaries: () => [] }))

import type { AppContext } from '../app-context'

function makeCtx(): AppContext {
  const pipeline = {
    active: false,
    switchEngine: vi.fn().mockResolvedValue(undefined),
    setGlossary: vi.fn(),
    setLanguageConfig: vi.fn(),
    setSimulMt: vi.fn(),
    setDraftSttEnabled: vi.fn(),
    setDiarizationEnabled: vi.fn(),
    start: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined)
  }
  return { pipeline, mainWindow: null, logger: null } as unknown as AppContext
}

const config = { mode: 'cascade', sttEngineId: 'stt', translatorEngineId: 'tr' }

describe('pipeline-start privacy defaults', () => {
  let ctx: AppContext
  let store: typeof import('../store').store

  // A fresh module graph per case gives every test the pristine shipped defaults.
  beforeEach(async () => {
    vi.resetModules()
    handlers.clear()
    startSession.mockClear()
    store = (await import('../store')).store
    const { registerPipelineIpc } = await import('./pipeline-ipc')
    ctx = makeCtx()
    registerPipelineIpc(ctx)
  })

  it('writes no transcript logger and no activeSession with the shipped defaults', async () => {
    const result = await handlers.get('pipeline-start')!(null, { ...config })
    expect(result).toEqual({ success: true })
    expect(ctx.logger).toBeNull()
    expect(startSession).not.toHaveBeenCalled()
    expect(store.get('activeSession') ?? null).toBeNull()
  })

  it('creates the transcript logger only after saveTranscripts is enabled', async () => {
    store.set('saveTranscripts', true)
    await handlers.get('pipeline-start')!(null, { ...config })
    expect(ctx.logger).not.toBeNull()
    expect(startSession).toHaveBeenCalledTimes(1)
  })

  it('persists activeSession only after sessionRecoveryEnabled is enabled', async () => {
    store.set('sessionRecoveryEnabled', true)
    await handlers.get('pipeline-start')!(null, { ...config })
    expect(store.get('activeSession')).toMatchObject({ config })
  })
})
