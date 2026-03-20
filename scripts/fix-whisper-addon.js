// Fix whisper-node-addon issues on macOS:
// 1. Directory naming: addon expects 'darwin-arm64' but ships as 'mac-arm64'
// 2. dylib rpath: libraries have hardcoded build paths, need to add local rpath
// 3. Copy vad-web assets to renderer public dir for serving
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const addonDist = path.join(__dirname, '..', 'node_modules', '@kutalia', 'whisper-node-addon', 'dist')

if (!fs.existsSync(addonDist)) {
  console.log('[fix-whisper-addon] Addon not installed, skipping')
  process.exit(0)
}

// Fix 1: Create symlinks for platform naming (macOS only)
if (process.platform === 'darwin') {
  const symlinkMappings = [
    { from: 'mac-arm64', to: 'darwin-arm64' },
    { from: 'mac-x64', to: 'darwin-x64' }
  ]

  for (const { from, to } of symlinkMappings) {
    const source = path.join(addonDist, from)
    const target = path.join(addonDist, to)

    if (fs.existsSync(source) && !fs.existsSync(target)) {
      fs.symlinkSync(from, target, 'dir')
      console.log(`[fix-whisper-addon] Created symlink: ${to} -> ${from}`)
    }
  }
} else {
  console.log('[fix-whisper-addon] Skipping symlinks on non-macOS platform')
}

// Fix 2: Add rpath for dylib loading (macOS only)
if (process.platform === 'darwin') {
  const archDir = process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  const addonDir = path.join(addonDist, archDir)
  const whisperNode = path.join(addonDir, 'whisper.node')

  if (fs.existsSync(whisperNode)) {
    try {
      execSync(`install_name_tool -add_rpath "${addonDir}" "${whisperNode}" 2>/dev/null || true`)
      console.log(`[fix-whisper-addon] Added rpath: ${addonDir}`)
    } catch (e) {
      console.warn(`[fix-whisper-addon] Failed to add rpath: ${e.message}`)
    }
  }
}

// Fix 3: Copy vad-web assets to renderer public directory
const vadSrc = path.join(__dirname, '..', 'node_modules', '@ricky0123', 'vad-web', 'dist')
const vadDest = path.join(__dirname, '..', 'src', 'renderer', 'public', 'vad')

if (fs.existsSync(vadSrc)) {
  fs.mkdirSync(vadDest, { recursive: true })
  const assetsToCopy = [
    'silero_vad_legacy.onnx',
    'silero_vad_v5.onnx',
    'vad.worklet.bundle.min.js'
  ]
  for (const file of assetsToCopy) {
    const src = path.join(vadSrc, file)
    const dest = path.join(vadDest, file)
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest)
      console.log(`[fix-whisper-addon] Copied VAD asset: ${file}`)
    }
  }

  // Copy ONNX Runtime WASM files
  const ortDist = path.join(__dirname, '..', 'node_modules', 'onnxruntime-web', 'dist')
  if (fs.existsSync(ortDist)) {
    for (const file of fs.readdirSync(ortDist)) {
      if (file.endsWith('.wasm')) {
        fs.copyFileSync(path.join(ortDist, file), path.join(vadDest, file))
        console.log(`[fix-whisper-addon] Copied ORT WASM: ${file}`)
      }
    }
  }
} else {
  console.log('[fix-whisper-addon] vad-web not installed, skipping asset copy')
}
