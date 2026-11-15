import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { mkdtempSync, realpathSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'

let app: ElectronApplication
let userDataDir: string

// A fresh userData directory so the test starts from default character
// settings and never touches the developer's own settings
test.beforeAll(async () => {
  // realpath: on macOS the temp dir sits behind the /var -> /private/var symlink
  userDataDir = realpathSync(mkdtempSync(join(tmpdir(), 'live-translate-e2e-character-')))
  app = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js'), `--user-data-dir=${userDataDir}`],
    env: {
      ...process.env,
      ELECTRON_DISABLE_GPU: '1',
      SKIP_ONBOARDING: '1'
    }
  })
})

test.afterAll(async () => {
  await app?.close()
  if (userDataDir) rmSync(userDataDir, { recursive: true, force: true })
})

async function findWindow(match: (url: string) => boolean): Promise<Page> {
  let found: Page | undefined
  await expect
    .poll(
      () => {
        found = app.windows().find((w) => match(w.url()))
        return Boolean(found)
      },
      { timeout: 20_000 }
    )
    .toBe(true)
  return found as Page
}

test('uses the isolated userData directory', async () => {
  const path = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'))
  expect(path).toBe(userDataDir)
})

test('changing the character in settings changes the desktop character', async () => {
  const settings = await findWindow((url) => !url.includes('#/'))
  const character = await findWindow((url) => url.endsWith('#/character'))

  const overlay = character.getByTestId('character-overlay')
  await expect(overlay).toHaveAttribute('data-character-id', 'builtin-mochi', { timeout: 15_000 })
  const sprite = overlay.locator('img')
  await expect(sprite).toHaveAttribute('src', /^data:image\/svg\+xml/)
  const mochiSrc = await sprite.getAttribute('src')

  await settings.getByTestId('character-settings-toggle').click()
  const pico = settings.getByTestId('character-option-builtin-pico')
  await pico.click()
  await expect(pico).toHaveAttribute('aria-checked', 'true')

  await expect(overlay).toHaveAttribute('data-character-id', 'builtin-pico')
  await expect(sprite).not.toHaveAttribute('src', mochiSrc ?? '')
})

test('hiding the character from settings hides its window', async () => {
  const settings = await findWindow((url) => !url.includes('#/'))
  const visible = settings.getByTestId('character-visible')
  if (!(await visible.isVisible())) await settings.getByTestId('character-settings-toggle').click()

  await visible.uncheck()
  await expect
    .poll(() =>
      app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows().some((w) => w.webContents.getURL().endsWith('#/character') && w.isVisible())
      )
    )
    .toBe(false)
})

test('the glossary and memory screen opens empty', async () => {
  const settings = await findWindow((url) => !url.includes('#/'))
  await settings.getByTestId('open-memory-screen').click()
  await expect(settings.getByTestId('memory-screen')).toContainText('Nothing has been remembered yet')
})
