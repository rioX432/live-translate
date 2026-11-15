import { MessageChannelMain, type MessagePortMain, type WebContents } from 'electron'
import { createLogger } from './logger'
import { parseAudioMessage, routeAudio, type AudioMessageKind } from './audio-routing'
import type { AppContext } from './app-context'

const log = createLogger('audio-port')

const KIND_BY_TYPE: Record<string, AudioMessageKind> = {
  'process-audio-streaming': 'interim',
  'finalize-streaming': 'final'
}

let activePort: MessagePortMain | null = null

/**
 * Give the renderer a MessagePort for zero-copy audio transfer.
 *
 * The renderer asks for the port once its listener is attached (a port pushed
 * on did-finish-load can arrive before React mounts and be lost), and asks
 * again after a reload, so each request replaces the previous channel.
 * A MessagePort cannot cross contextBridge, so the preload relays it to the
 * page with window.postMessage.
 */
export function setupAudioPort(ctx: AppContext, target: WebContents): void {
  try {
    const { port1, port2 } = new MessageChannelMain()

    port1.on('message', (event) => {
      const data = event.data as Record<string, unknown> | null
      const kind = typeof data?.type === 'string' ? KIND_BY_TYPE[data.type] : undefined
      if (!kind) {
        // Never log the payload: it can hold meeting audio
        log.warn(`Dropped audio-port message without a usable payload (data ${data === null ? 'is null' : typeof data})`)
        return
      }
      const msg = parseAudioMessage(kind, data)
      if (!msg) {
        log.warn(`Ignored malformed ${kind} message`)
        return
      }
      void routeAudio(ctx, msg, 'port')
    })
    port1.start()

    activePort?.close()
    activePort = port1

    target.postMessage('audio-port', null, [port2])
    log.info('Audio MessagePort channel established')
  } catch (err) {
    log.error('Failed to set up audio MessagePort; the renderer keeps using invoke IPC:', err)
  }
}
