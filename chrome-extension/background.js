/**
 * Service worker background script for the Live Translate Chrome extension.
 *
 * Responsibilities:
 * - Obtain a tab capture stream ID via chrome.tabCapture.getMediaStreamId()
 * - Manage the offscreen document lifecycle
 * - Relay start/stop messages between popup and offscreen document
 */

const OFFSCREEN_URL = 'offscreen.html'

/** Track capture state */
let capturing = false

/**
 * Ensure the offscreen document exists, creating it if needed.
 */
async function ensureOffscreenDocument() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(OFFSCREEN_URL)]
  })

  if (contexts.length > 0) {
    return // Already exists
  }

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['USER_MEDIA'],
    justification: 'Capture tab audio for real-time translation'
  })
}

/**
 * Start capturing audio from the active tab.
 * Must be called from a user gesture context (popup click).
 */
async function startCapture(tabId, wsPort) {
  if (capturing) {
    return { error: 'Already capturing' }
  }

  try {
    // Get the media stream ID for the target tab
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tabId
    })

    // Ensure offscreen document is ready
    await ensureOffscreenDocument()

    // Send stream ID and WebSocket port to offscreen document
    await chrome.runtime.sendMessage({
      type: 'start-capture',
      streamId,
      wsPort
    })

    capturing = true
    return { success: true }
  } catch (err) {
    console.error('[background] Failed to start capture:', err)
    return { error: err.message || String(err) }
  }
}

/**
 * Stop the current capture session.
 */
async function stopCapture() {
  if (!capturing) {
    return { success: true }
  }

  try {
    await chrome.runtime.sendMessage({ type: 'stop-capture' })
  } catch {
    // Offscreen document may already be closed
  }

  capturing = false
  return { success: true }
}

// Handle messages from popup and offscreen document
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'start-capture') {
    // This message is also received by the offscreen document; ignore in background
    return false
  }

  if (message.type === 'popup-start') {
    startCapture(message.tabId, message.wsPort).then(sendResponse)
    return true // Async response
  }

  if (message.type === 'popup-stop') {
    stopCapture().then(sendResponse)
    return true
  }

  if (message.type === 'get-status') {
    sendResponse({ capturing })
    return false
  }

  if (message.type === 'capture-stopped') {
    // Offscreen document reports capture ended (e.g., tab closed)
    capturing = false
    return false
  }

  return false
})
