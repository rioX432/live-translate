import type { BrowserWindow } from 'electron'
import type { TranslationPipeline } from '../pipeline/TranslationPipeline'
import type { TranscriptLogger } from '../logger/TranscriptLogger'
import type { WsAudioServer } from './ws-audio-server'
import type { TTSManager } from './tts-manager'

/**
 * Shared application state accessed by all main-process modules.
 *
 * Properties are implemented as getters/setters backed by a private store
 * so that closures always read the current instance — never a stale
 * reference captured at registration time.
 */
export interface AppContext {
  mainWindow: BrowserWindow | null
  subtitleWindow: BrowserWindow | null
  pipeline: TranslationPipeline | null
  logger: TranscriptLogger | null
  wsAudioServer: WsAudioServer | null
  ttsManager: TTSManager | null
}

/** Backing store for AppContext getter/setter properties */
interface AppContextStore {
  mainWindow: BrowserWindow | null
  subtitleWindow: BrowserWindow | null
  pipeline: TranslationPipeline | null
  logger: TranscriptLogger | null
  wsAudioServer: WsAudioServer | null
  ttsManager: TTSManager | null
}

/**
 * Create an AppContext whose properties are getter/setter pairs.
 * This prevents stale references: even if a consumer destructures or
 * caches `ctx`, property access always reads from the backing store.
 */
export function createAppContext(): AppContext {
  const store: AppContextStore = {
    mainWindow: null,
    subtitleWindow: null,
    pipeline: null,
    logger: null,
    wsAudioServer: null,
    ttsManager: null
  }

  return Object.defineProperties({} as AppContext, {
    mainWindow: {
      get: () => store.mainWindow,
      set: (v: BrowserWindow | null) => { store.mainWindow = v },
      enumerable: true,
      configurable: false
    },
    subtitleWindow: {
      get: () => store.subtitleWindow,
      set: (v: BrowserWindow | null) => { store.subtitleWindow = v },
      enumerable: true,
      configurable: false
    },
    pipeline: {
      get: () => store.pipeline,
      set: (v: TranslationPipeline | null) => { store.pipeline = v },
      enumerable: true,
      configurable: false
    },
    logger: {
      get: () => store.logger,
      set: (v: TranscriptLogger | null) => { store.logger = v },
      enumerable: true,
      configurable: false
    },
    wsAudioServer: {
      get: () => store.wsAudioServer,
      set: (v: WsAudioServer | null) => { store.wsAudioServer = v },
      enumerable: true,
      configurable: false
    },
    ttsManager: {
      get: () => store.ttsManager,
      set: (v: TTSManager | null) => { store.ttsManager = v },
      enumerable: true,
      configurable: false
    }
  })
}
