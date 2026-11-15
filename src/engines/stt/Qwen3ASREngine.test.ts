import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import type { ChildProcessWithoutNullStreams } from 'child_process'
import { describe, it, expect, vi } from 'vitest'

// model-downloader imports electron's app at module load.
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/live-translate-test', isPackaged: false } }))
import { Qwen3ASREngine, mapQwen3Language, resolveQwen3HelperPath } from './Qwen3ASREngine'

type Reply = (request: Record<string, unknown>) => Record<string, unknown>

/** Fake helper that is ready at once and answers each stdin line with `reply`. */
function fakeHelper(reply: Reply) {
  const requests: Record<string, unknown>[] = []
  const spawnFn = vi.fn((_command: string, _args: string[]) => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    Object.assign(child, { stdin, stdout, stderr: new PassThrough(), exitCode: null, signalCode: null })
    child.kill = () => {
      child.exitCode = 0
      setImmediate(() => child.emit('exit', 0, null))
      return true
    }
    let buffer = ''
    stdin.setEncoding('utf8')
    stdin.on('data', (chunk: string) => {
      buffer += chunk
      let newline: number
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const request = JSON.parse(buffer.slice(0, newline)) as Record<string, unknown>
        buffer = buffer.slice(newline + 1)
        requests.push(request)
        stdout.write(JSON.stringify({ id: request.id, ...reply(request) }) + '\n')
      }
    })
    stdin.on('finish', () => (child.kill as () => boolean)())
    setImmediate(() => stdout.write('{"ready":true}\n'))
    return child as unknown as ChildProcessWithoutNullStreams
  })
  return { spawnFn, requests }
}

function engineWith(reply: Reply) {
  const { spawnFn, requests } = fakeHelper(reply)
  const engine = new Qwen3ASREngine({ helperPath: '/fake/helper', modelDir: '/fake/model', spawnFn })
  return { engine, spawnFn, requests }
}

describe('mapQwen3Language', () => {
  it('maps the names Qwen3-ASR reports', () => {
    expect(mapQwen3Language('Japanese', 'こんにちは')).toBe('ja')
    expect(mapQwen3Language('English', 'hello')).toBe('en')
    expect(mapQwen3Language('Chinese', '你好')).toBe('zh')
  })

  it('uses the first name when chunks report several', () => {
    expect(mapQwen3Language('English,Japanese', 'hello こんにちは')).toBe('en')
  })

  it('falls back to the script for missing or unknown names', () => {
    expect(mapQwen3Language('', 'こんにちは')).toBe('ja')
    expect(mapQwen3Language('Klingon', 'hello')).toBe('en')
    expect(mapQwen3Language('None', '会議')).toBe('ja')
  })
})

describe('resolveQwen3HelperPath', () => {
  it('uses Resources/ in a packaged app and resources/bin in a checkout', () => {
    expect(resolveQwen3HelperPath(true, '/App.app/Contents/Resources', '/repo'))
      .toBe('/App.app/Contents/Resources/qwen3-asr-helper/qwen3-asr-helper')
    expect(resolveQwen3HelperPath(false, '/ignored', '/repo'))
      .toBe('/repo/resources/bin/qwen3-asr-helper/qwen3-asr-helper')
  })
})

describe('Qwen3ASREngine', () => {
  it('starts the helper with the model directory, once', async () => {
    const { engine, spawnFn } = engineWith(() => ({ text: '' }))
    await Promise.all([engine.initialize(), engine.initialize()])
    expect(spawnFn).toHaveBeenCalledTimes(1)
    expect(spawnFn).toHaveBeenCalledWith('/fake/helper', ['/fake/model'])
    await engine.dispose()
  })

  it('sends float32 PCM as base64 and returns the text with the detected language', async () => {
    const { engine, requests } = engineWith(() => ({ text: ' 今日は晴れです ', language: 'Japanese', ms: 120 }))
    await engine.initialize()
    const audio = new Float32Array([0.25, -0.5, 1])
    const result = await engine.processAudio(audio, 16_000)

    expect(result).toMatchObject({ text: '今日は晴れです', language: 'ja', isFinal: true })
    const sent = Buffer.from(requests[0].pcm_f32_b64 as string, 'base64')
    expect(Array.from(new Float32Array(sent.buffer, sent.byteOffset, sent.byteLength / 4))).toEqual([0.25, -0.5, 1])
    await engine.dispose()
  })

  it('sends only the view of a subarray, not the whole backing buffer', async () => {
    const { engine, requests } = engineWith(() => ({ text: 'hi', language: 'English' }))
    await engine.initialize()
    const backing = new Float32Array([9, 1, 2, 9])
    await engine.processAudio(backing.subarray(1, 3), 16_000)
    expect(Buffer.from(requests[0].pcm_f32_b64 as string, 'base64').byteLength).toBe(8)
    await engine.dispose()
  })

  it('returns null for empty text and empty audio', async () => {
    const { engine, requests } = engineWith(() => ({ text: '   ', language: 'English' }))
    await engine.initialize()
    expect(await engine.processAudio(new Float32Array(1600), 16_000)).toBeNull()
    expect(await engine.processAudio(new Float32Array(0), 16_000)).toBeNull()
    expect(requests).toHaveLength(1)
    await engine.dispose()
  })

  it('throws when the helper reports an error', async () => {
    const { engine } = engineWith(() => ({ error: 'invalid pcm_f32_b64' }))
    await engine.initialize()
    await expect(engine.processAudio(new Float32Array(10), 16_000)).rejects.toThrow('invalid pcm_f32_b64')
    await engine.dispose()
  })

  it('throws before initialize and for audio at another sample rate', async () => {
    const { engine } = engineWith(() => ({ text: 'x' }))
    await expect(engine.processAudio(new Float32Array(10), 16_000)).rejects.toThrow('Not initialized')
    await engine.initialize()
    await expect(engine.processAudio(new Float32Array(10), 48_000)).rejects.toThrow('Expected 16000 Hz')
    await engine.dispose()
  })

  it('can be initialized again after dispose', async () => {
    const { engine, spawnFn } = engineWith(() => ({ text: 'again', language: 'English' }))
    await engine.initialize()
    await engine.dispose()
    await engine.dispose()
    await engine.initialize()
    expect(await engine.processAudio(new Float32Array(10), 16_000)).toMatchObject({ text: 'again' })
    expect(spawnFn).toHaveBeenCalledTimes(2)
    await engine.dispose()
  })
})
