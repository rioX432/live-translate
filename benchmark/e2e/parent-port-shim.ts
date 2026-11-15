/**
 * Gives a child_process.fork child the `process.parentPort` that Electron's
 * UtilityProcess provides. Must be imported before slm-worker so its top-level
 * listener registration sees the shim.
 */
type Listener = (event: { data: unknown }) => void

const port = {
  postMessage(message: unknown): void {
    process.send?.(message as object)
  },
  on(event: string, listener: Listener): void {
    if (event !== 'message') return
    process.on('message', (data) => listener({ data }))
  },
  once(event: string, listener: Listener): void {
    if (event !== 'message') return
    process.once('message', (data) => listener({ data }))
  }
}

;(process as unknown as { parentPort: typeof port }).parentPort = port

// The parent's death must not leave a model resident in memory.
process.on('disconnect', () => process.exit(0))
