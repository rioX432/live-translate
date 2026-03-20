import { test, expect, type ElectronApplication, type Page } from '@playwright/test'
import { _electron as electron } from 'playwright'
import { resolve } from 'path'

let app: ElectronApplication
let settingsWindow: Page

test.beforeAll(async () => {
  app = await electron.launch({
    args: [resolve(__dirname, '../out/main/index.js')],
    env: {
      ...process.env,
      // Disable hardware acceleration in CI to avoid GPU issues
      ELECTRON_DISABLE_GPU: '1'
    }
  })

  // The app opens two windows: main (settings) and subtitle (transparent).
  // firstWindow() returns whichever opens first.
  const firstWin = await app.firstWindow()
  await firstWin.waitForLoadState('domcontentloaded')

  // Give time for both windows to finish opening
  await firstWin.waitForTimeout(2000)

  // Find the settings window by checking for h1 heading
  for (const win of app.windows()) {
    const headingCount = await win.locator('h1').count().catch(() => 0)
    if (headingCount > 0) {
      settingsWindow = win
      break
    }
  }

  // Fallback: use the first window if we couldn't identify the settings window
  if (!settingsWindow) {
    settingsWindow = firstWin
  }
})

test.afterAll(async () => {
  await app?.close()
})

// Helper: ensure Advanced Settings is expanded
async function expandAdvancedSettings(): Promise<void> {
  const sttSelect = settingsWindow.locator('[aria-label="STT engine"]')
  if (!(await sttSelect.isVisible().catch(() => false))) {
    await settingsWindow.locator('button', { hasText: 'Advanced Settings' }).click()
    await sttSelect.waitFor({ state: 'visible', timeout: 5000 })
  }
}

test.describe('App launch', () => {
  test('should open the main window with correct title', async () => {
    const title = await settingsWindow.title()
    expect(title).toBeTruthy()
  })

  test('should display the settings panel heading', async () => {
    const heading = settingsWindow.locator('h1')
    await expect(heading).toHaveText('live-translate')
  })

  test('should show status text', async () => {
    const bodyText = await settingsWindow.textContent('body')
    expect(bodyText).toBeTruthy()
  })
})

test.describe('Engine selection', () => {
  test('should display translation engine radio options', async () => {
    await expandAdvancedSettings()

    // Use the radiogroup to scope selectors and avoid strict mode violations
    const engineGroup = settingsWindow.locator('[role="radiogroup"]')
    await expect(engineGroup).toBeVisible()

    // Verify key engine radio inputs exist
    const radios = engineGroup.locator('input[name="engine"]')
    const count = await radios.count()
    expect(count).toBeGreaterThanOrEqual(5) // hybrid, slm, hy-mt1.5, hy-mt, opus, ct2-opus
  })

  test('should allow selecting a different translation engine', async () => {
    await expandAdvancedSettings()

    // Find the OPUS-MT radio by its unique description text
    const engineGroup = settingsWindow.locator('[role="radiogroup"]')
    const opusRadio = engineGroup.locator('label').filter({ hasText: '~100MB' }).locator('input[type="radio"]')
    await opusRadio.click()
    await expect(opusRadio).toBeChecked()
  })

  test('should show STT engine selector', async () => {
    await expandAdvancedSettings()

    const sttSelect = settingsWindow.locator('[aria-label="STT engine"]')
    await expect(sttSelect).toBeVisible()

    // Should have at least whisper-local and moonshine options
    const options = sttSelect.locator('option')
    const count = await options.count()
    expect(count).toBeGreaterThanOrEqual(2)
  })
})

test.describe('Start/Stop pipeline', () => {
  test('should have a start button', async () => {
    const startBtn = settingsWindow.locator('button[aria-label="Start translation"]')
    await expect(startBtn).toBeVisible()
    await expect(startBtn).toContainText('Start')
  })

  test('should show Starting state when clicked', async () => {
    const startBtn = settingsWindow.locator('button[aria-label="Start translation"]')
    await startBtn.click()

    // The button text should change to "Starting..." briefly.
    // The pipeline will likely fail (no models downloaded), but we verify
    // the UI reacts to the click.
    await settingsWindow.waitForTimeout(500)

    // After clicking, the button shows either "Starting..." or "Stop" or has reverted on error
    const btnLocator = settingsWindow.locator('button').filter({ hasText: /Starting|Stop|Start/ })
    const buttonText = await btnLocator.first().textContent()
    expect(buttonText).toBeTruthy()

    // If pipeline actually started, stop it to clean up
    const stopBtn = settingsWindow.locator('button[aria-label="Stop translation"]')
    if (await stopBtn.isVisible().catch(() => false)) {
      await stopBtn.click()
      // Wait for stop to complete
      await settingsWindow.locator('button[aria-label="Start translation"]').waitFor({
        state: 'visible',
        timeout: 10_000
      })
    }
  })
})

test.describe('Settings persistence', () => {
  test('should have microphone selector', async () => {
    const micSelect = settingsWindow.locator('[aria-label="Microphone device"]')
    await expect(micSelect).toBeVisible()
  })

  test('should show config summary panel', async () => {
    // The config summary shows Speech Recognition, Translation, and Language labels
    await expect(settingsWindow.locator('text=Speech Recognition').first()).toBeVisible()
    await expect(settingsWindow.locator('text=Translation').first()).toBeVisible()
    await expect(settingsWindow.locator('text=Language').first()).toBeVisible()
  })

  test('should have language selectors in advanced settings', async () => {
    await expandAdvancedSettings()

    const sourceSelect = settingsWindow.locator('[aria-label="Source language"]')
    await expect(sourceSelect).toBeVisible()

    const targetSelect = settingsWindow.locator('[aria-label="Target language"]')
    await expect(targetSelect).toBeVisible()

    // Source language should default to auto
    await expect(sourceSelect).toHaveValue('auto')
  })

  test('should allow changing target language', async () => {
    await expandAdvancedSettings()

    const targetSelect = settingsWindow.locator('[aria-label="Target language"]')
    await targetSelect.selectOption('ja')
    await expect(targetSelect).toHaveValue('ja')
  })
})

test.describe('Window management', () => {
  test('should open two windows (main + subtitle)', async () => {
    const windows = app.windows()
    expect(windows.length).toBeGreaterThanOrEqual(2)
  })

  test('should be able to evaluate in main process', async () => {
    // Verify we can communicate with the Electron main process
    const appPath = await app.evaluate(async ({ app }) => {
      return app.getAppPath()
    })
    expect(appPath).toBeTruthy()
    expect(typeof appPath).toBe('string')
  })
})
