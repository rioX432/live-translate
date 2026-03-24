/**
 * Offscreen document for audio capture and WebSocket streaming.
 *
 * Receives a tab capture stream ID from the background service worker,
 * captures the audio via AudioWorkletNode, resamples to 16kHz mono
 * off the main thread, and streams raw Float32 PCM to the Electron
 * app via WebSocket.
 */

const TARGET_SAMPLE_RATE = 16000
const BUFFER_DURATION_MS = 3000
const WS_HEARTBEAT_INTERVAL_MS = 20000
const WS_RECONNECT_DELAY_MS = 2000
const WS_MAX_RECONNECT_ATTEMPTS = 5

let mediaStream = null
let audioContext = null
let sourceNode = null
let workletNode = null
let ws = null
let heartbeatTimer = null
let audioBuffer = []
let audioBufferLength = 0
let reconnectAttempts = 0
let wsPort = 9876
let isCapturing = false

/**
 * Connect to the WebSocket server in the Electron app.
 */
function connectWebSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return
  }

  ws = new WebSocket(`ws://127.0.0.1:${wsPort}`)
  ws.binaryType = 'arraybuffer'

  ws.onopen = () => {
    console.log('[offscreen] WebSocket connected')
    reconnectAttempts = 0

    // Send identification message
    ws.send(JSON.stringify({ type: 'hello', source: 'chrome-extension' }))

    // Start heartbeat to keep service worker alive
    startHeartbeat()
  }

  ws.onclose = () => {
    console.log('[offscreen] WebSocket disconnected')
    stopHeartbeat()

    // Auto-reconnect if still capturing
    if (isCapturing && reconnectAttempts < WS_MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts++
      console.log(`[offscreen] Reconnecting (${reconnectAttempts}/${WS_MAX_RECONNECT_ATTEMPTS})...`)
      setTimeout(connectWebSocket, WS_RECONNECT_DELAY_MS)
    }
  }

  ws.onerror = (err) => {
    console.error('[offscreen] WebSocket error:', err)
  }

  ws.onmessage = (event) => {
    // Handle control messages from the Electron app
    try {
      const msg = JSON.parse(event.data)
      if (msg.type === 'pong') {
        // Heartbeat acknowledged
      }
    } catch {
      // Binary data or non-JSON — ignore
    }
  }
}

function startHeartbeat() {
  stopHeartbeat()
  heartbeatTimer = setInterval(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'ping' }))
    }
  }, WS_HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

/**
 * Send buffered audio data over WebSocket as raw Float32 PCM.
 */
function flushAudioBuffer() {
  if (audioBufferLength === 0 || !ws || ws.readyState !== WebSocket.OPEN) {
    return
  }

  // Merge buffered chunks into a single Float32Array
  const merged = new Float32Array(audioBufferLength)
  let offset = 0
  for (const chunk of audioBuffer) {
    merged.set(chunk, offset)
    offset += chunk.length
  }

  // Send as binary (ArrayBuffer)
  ws.send(merged.buffer)

  audioBuffer = []
  audioBufferLength = 0
}

/**
 * Start capturing audio from the given stream ID.
 *
 * Registers the AudioWorklet processor, connects the audio graph,
 * and listens for downsampled audio chunks via MessagePort.
 */
async function startCapture(streamId, port) {
  wsPort = port || 9876
  isCapturing = true

  // Connect WebSocket first
  connectWebSocket()

  // Obtain the MediaStream from the tab capture stream ID
  mediaStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    }
  })

  // Set up AudioContext and processing
  const sampleRate = mediaStream.getAudioTracks()[0].getSettings().sampleRate || 48000
  audioContext = new AudioContext({ sampleRate })
  sourceNode = audioContext.createMediaStreamSource(mediaStream)

  // Load the AudioWorklet processor module
  // Use chrome.runtime.getURL() because addModule() cannot resolve relative
  // paths inside Chrome extension contexts.
  const processorUrl = chrome.runtime.getURL('audio-processor.js')
  await audioContext.audioWorklet.addModule(processorUrl)

  // Create the worklet node, passing sample rates so it can downsample
  workletNode = new AudioWorkletNode(audioContext, 'audio-capture-processor', {
    numberOfInputs: 1,
    numberOfOutputs: 0,
    channelCount: 1,
    processorOptions: {
      sourceSampleRate: sampleRate,
      targetSampleRate: TARGET_SAMPLE_RATE
    }
  })

  const targetSamplesPerBuffer = Math.floor(TARGET_SAMPLE_RATE * (BUFFER_DURATION_MS / 1000))

  // Receive downsampled audio chunks from the worklet via MessagePort
  workletNode.port.onmessage = (event) => {
    if (event.data.type !== 'audio') {
      return
    }

    const resampled = new Float32Array(event.data.samples)

    audioBuffer.push(resampled)
    audioBufferLength += resampled.length

    // Flush when we have enough data (3 seconds)
    if (audioBufferLength >= targetSamplesPerBuffer) {
      flushAudioBuffer()
    }
  }

  sourceNode.connect(workletNode)

  // Detect when the tab's audio track ends (tab closed or navigated away)
  mediaStream.getAudioTracks()[0].addEventListener('ended', () => {
    console.log('[offscreen] Audio track ended')
    stopCapture()
    chrome.runtime.sendMessage({ type: 'capture-stopped' })
  })

  console.log(`[offscreen] Capturing at ${sampleRate}Hz, resampling to ${TARGET_SAMPLE_RATE}Hz via AudioWorklet`)
}

/**
 * Stop the current capture session and clean up resources.
 */
function stopCapture() {
  isCapturing = false

  // Flush remaining audio
  flushAudioBuffer()

  if (workletNode) {
    // Signal the worklet processor to stop, then disconnect
    workletNode.port.postMessage({ type: 'stop' })
    workletNode.disconnect()
    workletNode = null
  }

  if (sourceNode) {
    sourceNode.disconnect()
    sourceNode = null
  }

  if (audioContext) {
    audioContext.close().catch(() => {})
    audioContext = null
  }

  if (mediaStream) {
    mediaStream.getTracks().forEach((track) => track.stop())
    mediaStream = null
  }

  // Close WebSocket
  stopHeartbeat()
  if (ws) {
    ws.close()
    ws = null
  }

  reconnectAttempts = 0
  audioBuffer = []
  audioBufferLength = 0
}

// Listen for messages from background service worker
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'start-capture') {
    startCapture(message.streamId, message.wsPort)
      .then(() => sendResponse({ success: true }))
      .catch((err) => sendResponse({ error: err.message }))
    return true // Async response
  }

  if (message.type === 'stop-capture') {
    stopCapture()
    sendResponse({ success: true })
    return false
  }

  return false
})
