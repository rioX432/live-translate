import type { AppContext } from './app-context'
import { registerPipelineIpc } from './ipc/pipeline-ipc'
import { registerSettingsIpc } from './ipc/settings-ipc'
import { registerSessionIpc } from './ipc/session-ipc'
import { registerDisplayIpc } from './ipc/display-ipc'
import { registerModelIpc } from './ipc/model-ipc'
import { registerQuickStartIpc } from './ipc/quickstart-ipc'
import { registerShortcutIpc } from './ipc/shortcut-ipc'
import { registerOnboardingIpc } from './ipc/onboarding-ipc'

/** Register all IPC handlers */
export function registerIpcHandlers(ctx: AppContext): void {
  registerPipelineIpc(ctx)
  registerSettingsIpc(ctx)
  registerSessionIpc(ctx)
  registerDisplayIpc(ctx)
  registerModelIpc()
  registerQuickStartIpc(ctx)
  registerShortcutIpc()
  registerOnboardingIpc(ctx)
}
