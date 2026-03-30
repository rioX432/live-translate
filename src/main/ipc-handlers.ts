import type { AppContext } from './app-context'
import { registerPipelineIpc } from './ipc/pipeline-ipc'
import { registerSettingsIpc } from './ipc/settings-ipc'
import { registerSessionIpc } from './ipc/session-ipc'
import { registerDisplayIpc } from './ipc/display-ipc'
import { registerAudioIpc } from './ipc/audio-ipc'
import { registerModelIpc } from './ipc/model-ipc'

/** Register all IPC handlers (pipeline, settings, session, display, model, ws-audio) */
export function registerIpcHandlers(ctx: AppContext): void {
  registerPipelineIpc(ctx)
  registerSettingsIpc(ctx)
  registerSessionIpc(ctx)
  registerDisplayIpc(ctx)
  registerModelIpc()
  registerAudioIpc(ctx)
}
