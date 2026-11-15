import { test, expect, type ElectronApplication } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { mkdtempSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

let app: ElectronApplication
let userDataDir: string

test.beforeAll(async () => {
  // realpath: on macOS the temp dir sits behind the /var -> /private/var symlink
  userDataDir = realpathSync(mkdtempSync(join(tmpdir(), 'live-translate-e2e-vad-')))
  app = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${userDataDir}`],
    env: { ...process.env, ELECTRON_DISABLE_GPU: '1', SKIP_ONBOARDING: '1' }
  })
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
})

// The built renderer loads from file:// and fetches the VAD model and ONNX runtime through
// vad-asset://; without that working, recording never starts
test('the built renderer can fetch VAD assets through vad-asset://', async () => {
  await expect.poll(() => app.windows().some((w) => w.url().startsWith('file:')), { timeout: 20_000 }).toBe(true)
  const page = app.windows().find((w) => w.url().startsWith('file:'))!
  await page.waitForLoadState('domcontentloaded')
  const results = await page.evaluate(async () => {
    const files = ['silero_vad_legacy.onnx', 'ort-wasm-simd-threaded.mjs']
    return Promise.all(
      files.map(async (f) => {
        try {
          const res = await fetch(`vad-asset://host/${f}`)
          return `${f}:${res.status}:${(await res.arrayBuffer()).byteLength > 0}`
        } catch (e) {
          return `${f}:${(e as Error).message}`
        }
      })
    )
  })
  expect(results).toEqual(['silero_vad_legacy.onnx:200:true', 'ort-wasm-simd-threaded.mjs:200:true'])
})
