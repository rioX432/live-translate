import { describe, it, expect, vi, beforeEach } from 'vitest'

type MessageListener = (event: { data: unknown }) => void

const state = vi.hoisted(() => ({ listener: null as null | ((event: { data: unknown }) => void) }))
const warn = vi.hoisted(() => vi.fn())
const routeAudio = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  MessageChannelMain: class {
    port1 = {
      on: (_name: string, fn: MessageListener) => { state.listener = fn },
      start: vi.fn(),
      close: vi.fn()
    }
    port2 = {}
  }
}))
vi.mock('./logger', () => ({
  createLogger: () => ({ info: vi.fn(), warn, error: vi.fn(), debug: vi.fn() })
}))
vi.mock('./audio-routing', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./audio-routing')>()),
  routeAudio
}))

import { setupAudioPort } from './audio-port'
import type { AppContext } from './app-context'

function open(): MessageListener {
  setupAudioPort({} as AppContext, { postMessage: vi.fn() } as never)
  return state.listener as MessageListener
}

describe('setupAudioPort message handling', () => {
  beforeEach(() => {
    warn.mockClear()
    routeAudio.mockClear()
  })

  it('warns and routes nothing when the payload arrives as null', () => {
    open()({ data: null })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(routeAudio).not.toHaveBeenCalled()
  })

  it('warns when the message type is unknown', () => {
    open()({ data: { type: 'nope' } })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(routeAudio).not.toHaveBeenCalled()
  })

  it('routes a well-formed interim message without warning', () => {
    open()({ data: { type: 'process-audio-streaming', segmentId: 's1', audio: new Float32Array(4).buffer } })
    expect(warn).not.toHaveBeenCalled()
    expect(routeAudio).toHaveBeenCalledTimes(1)
  })
})
