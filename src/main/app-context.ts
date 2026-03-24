import type { BrowserWindow } from 'electron'
import type { TranslationPipeline } from '../pipeline/TranslationPipeline'
import type { TranscriptLogger } from '../logger/TranscriptLogger'
import type { WsAudioServer } from './ws-audio-server'

/**
 * Shared mutable state accessed by all main-process modules.
 * Passed by reference so mutations are visible across modules.
 */
export interface AppContext {
  mainWindow: BrowserWindow | null
  subtitleWindow: BrowserWindow | null
  pipeline: TranslationPipeline | null
  logger: TranscriptLogger | null
  wsAudioServer: WsAudioServer | null
}
