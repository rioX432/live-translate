import { app, ipcMain } from 'electron'
import { join } from 'path'
import * as SessionManager from '../../logger/SessionManager'
import { getGGUFDir, downloadGGUF, getGGUFVariants } from '../../engines/model-downloader'
import type { SLMModelSize } from '../../engines/model-downloader'
import { workerPool } from '../worker-pool'
import { store } from '../store'
import { sanitizeErrorMessage } from '../error-utils'
import { validateSessionId, validateSearchQuery, validatePathWithinDir, VALID_EXPORT_FORMATS } from '../ipc-validators'
import type { ExportFormat } from '../ipc-validators'
import type { AppContext } from '../app-context'

/** Register session management IPC handlers */
export function registerSessionIpc(ctx: AppContext): void {
  // #124: Generate meeting summary from transcript
  ipcMain.handle('generate-summary', async (_event, transcriptPath: string) => {
    try {
      // #150: Validate path is within expected logs directory (symlink-safe)
      const { readFileSync } = await import('fs')
      const logsDir = app.getPath('userData')
      const pathResult = validatePathWithinDir(transcriptPath, logsDir)
      if ('error' in pathResult) {
        return { error: 'Invalid transcript path' }
      }
      const transcript = readFileSync(pathResult.path, 'utf-8')

      if (!transcript.trim()) {
        return { error: 'Transcript is empty' }
      }

      // Use shared worker pool for summarization
      const modelSize = (store.get('slmModelSize') as SLMModelSize) || '4b'
      const variants = getGGUFVariants(modelSize)
      const variantConfig = variants['Q4_K_M']!
      const modelPath = join(getGGUFDir(), variantConfig.filename)
      await downloadGGUF(variantConfig.filename, variantConfig.url,
        (msg) => ctx.mainWindow?.webContents.send('status-update', msg),
        variantConfig.sha256)

      await workerPool.acquire({
        modelPath,
        kvCacheQuant: store.get('slmKvCacheQuant') as boolean
      }, (msg) => ctx.mainWindow?.webContents.send('status-update', msg))

      try {
        const summary = await workerPool.sendRequest(
          { type: 'summarize', transcript },
          'summarize'
        )
        return { summary }
      } finally {
        await workerPool.release()
      }
    } catch (err) {
      return { error: sanitizeErrorMessage(err instanceof Error ? err.message : String(err)) }
    }
  })

  // #121: Session management
  ipcMain.handle('list-sessions', () => SessionManager.listSessions())
  ipcMain.handle('load-session', (_event, id: string) => {
    const err = validateSessionId(id)
    if (err) return { error: err }
    return SessionManager.loadSession(id)
  })
  ipcMain.handle('search-sessions', (_event, query: string) => {
    const err = validateSearchQuery(query)
    if (err) return { error: err }
    return SessionManager.searchSessions(query)
  })
  ipcMain.handle('delete-session', (_event, id: string) => {
    const err = validateSessionId(id)
    if (err) return { error: err }
    SessionManager.deleteSession(id)
    return { success: true }
  })
  ipcMain.handle('export-session', (_event, id: string, format: ExportFormat) => {
    const err = validateSessionId(id)
    if (err) return { error: err }
    const safeFormat = (VALID_EXPORT_FORMATS as readonly string[]).includes(format) ? format : 'text'
    const data = SessionManager.loadSession(id)
    if (!data) return { error: 'Session not found' }
    switch (safeFormat) {
      case 'srt': return { content: SessionManager.exportAsSRT(data), ext: '.srt' }
      case 'markdown': return { content: SessionManager.exportAsMarkdown(data), ext: '.md' }
      default: return { content: SessionManager.exportAsText(data), ext: '.txt' }
    }
  })

  ipcMain.handle('get-session-logs', () => store.get('sessionLogs') || [])
}
