/**
 * Popup script for the Live Translate Chrome extension.
 *
 * Handles user interaction for starting/stopping tab audio capture
 * and displays meeting platform detection.
 */

/** Known meeting platform patterns */
const MEETING_PLATFORMS = [
  { pattern: /meet\.google\.com/i, name: 'Google Meet' },
  { pattern: /zoom\.us/i, name: 'Zoom' },
  { pattern: /teams\.microsoft\.com/i, name: 'Microsoft Teams' },
  { pattern: /teams\.live\.com/i, name: 'Microsoft Teams' },
  { pattern: /discord\.com/i, name: 'Discord' },
  { pattern: /webex\.com/i, name: 'Cisco Webex' },
  { pattern: /whereby\.com/i, name: 'Whereby' },
  { pattern: /gather\.town/i, name: 'Gather' }
]

const startBtn = document.getElementById('startBtn')
const stopBtn = document.getElementById('stopBtn')
const statusBadge = document.getElementById('statusBadge')
const tabTitle = document.getElementById('tabTitle')
const platformInfo = document.getElementById('platformInfo')
const platformName = document.getElementById('platformName')
const errorBox = document.getElementById('errorBox')
const wsPortInput = document.getElementById('wsPort')

let currentTabId = null

/**
 * Detect meeting platform from URL.
 */
function detectPlatform(url) {
  if (!url) return null
  for (const platform of MEETING_PLATFORMS) {
    if (platform.pattern.test(url)) {
      return platform.name
    }
  }
  return null
}

/**
 * Show an error message to the user.
 */
function showError(msg) {
  errorBox.textContent = msg
  errorBox.style.display = 'block'
}

/**
 * Clear the error display.
 */
function clearError() {
  errorBox.style.display = 'none'
}

/**
 * Update UI based on capture state.
 */
function updateUI(capturing) {
  if (capturing) {
    startBtn.style.display = 'none'
    stopBtn.style.display = 'block'
    statusBadge.className = 'status-badge capturing'
    wsPortInput.disabled = true
  } else {
    startBtn.style.display = 'block'
    stopBtn.style.display = 'none'
    statusBadge.className = 'status-badge'
    wsPortInput.disabled = false
  }
}

/**
 * Load saved port from localStorage.
 */
function loadSavedPort() {
  const saved = localStorage.getItem('live-translate-ws-port')
  if (saved) {
    wsPortInput.value = saved
  }
}

/**
 * Save port to localStorage.
 */
function savePort() {
  localStorage.setItem('live-translate-ws-port', wsPortInput.value)
}

// Initialize popup
async function init() {
  loadSavedPort()

  // Get current tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
  if (tab) {
    currentTabId = tab.id
    tabTitle.textContent = tab.title || tab.url || 'Unknown'

    const platform = detectPlatform(tab.url)
    if (platform) {
      platformInfo.style.display = 'block'
      platformName.textContent = platform
    }
  } else {
    tabTitle.textContent = 'No active tab'
    startBtn.disabled = true
  }

  // Check current capture status
  chrome.runtime.sendMessage({ type: 'get-status' }, (response) => {
    if (response && response.capturing) {
      updateUI(true)
    }
  })
}

// Start capture button
startBtn.addEventListener('click', async () => {
  clearError()
  savePort()

  if (!currentTabId) {
    showError('No active tab to capture')
    return
  }

  const port = parseInt(wsPortInput.value, 10)
  if (isNaN(port) || port < 1024 || port > 65535) {
    showError('Invalid port number (1024-65535)')
    return
  }

  startBtn.disabled = true
  startBtn.textContent = 'Starting...'

  chrome.runtime.sendMessage(
    {
      type: 'popup-start',
      tabId: currentTabId,
      wsPort: port
    },
    (response) => {
      if (response && response.success) {
        updateUI(true)
      } else {
        const errMsg = response?.error || 'Failed to start capture'
        showError(errMsg)
        startBtn.disabled = false
        startBtn.textContent = 'Start Capture'
      }
    }
  )
})

// Stop capture button
stopBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'popup-stop' }, () => {
    updateUI(false)
  })
})

init()
