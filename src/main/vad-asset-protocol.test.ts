import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { createVadAssetHandler } from './vad-asset-protocol'

describe('createVadAssetHandler', () => {
  let root: string
  let vadDir: string
  const fetchFile = async (fileUrl: string): Promise<Response> => {
    try {
      return new Response(readFileSync(fileURLToPath(fileUrl)))
    } catch {
      return new Response(null, { status: 500 })
    }
  }

  beforeAll(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'vad-asset-test-')))
    vadDir = join(root, 'renderer', 'vad')
    mkdirSync(vadDir, { recursive: true })
    writeFileSync(join(vadDir, 'model.onnx'), 'model')
    writeFileSync(join(root, 'secret.txt'), 'secret')
  })

  afterAll(() => {
    rmSync(root, { recursive: true, force: true })
  })

  const get = (path: string): Promise<Response> =>
    createVadAssetHandler(vadDir, fetchFile)(new Request(`vad-asset://host/${path}`))

  it('serves a file inside the VAD directory', async () => {
    const res = await get('model.onnx')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('model')
  })

  // file: URLs treat a backslash as a separator, so %5C escapes as well as %2F
  it.each(['..%2F..%2Fsecret.txt', '%2E%2E%2F%2E%2E%2Fsecret.txt', '..%5C..%5Csecret.txt'])(
    'refuses %s, which points outside the VAD directory',
    async (path) => {
      const res = await get(path)
      expect(res.status).toBe(404)
    }
  )

  it('returns 404 for a file that does not exist, or for the directory itself', async () => {
    expect((await get('missing.onnx')).status).toBe(404)
    expect((await get('')).status).toBe(404)
  })

  it('returns 400 for a malformed percent-encoding', async () => {
    expect((await get('%E0%A4%A')).status).toBe(400)
  })
})
