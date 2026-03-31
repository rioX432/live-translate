// After-pack hook for electron-builder:
// Recreate whisper-node-addon symlinks and fix rpath in the unpacked asar directory.
// Handles both macOS (symlinks + rpath) and Windows (junctions).
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

exports.default = async function afterPack(context) {
  const platform = context.packager.platform.name // 'mac', 'windows', 'linux'

  if (platform === 'mac') {
    await fixMacOS(context)
  } else if (platform === 'windows') {
    await fixWindows(context)
  }
}

async function fixMacOS(context) {
  const appOutDir = context.appOutDir
  const unpackedBase = path.join(
    appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Resources',
    'app.asar.unpacked',
    'node_modules',
    '@kutalia',
    'whisper-node-addon',
    'dist'
  )

  if (!fs.existsSync(unpackedBase)) {
    console.log('[after-pack] whisper-node-addon dist not found in unpacked asar, skipping')
    return
  }

  // Recreate platform symlinks (may be lost during packaging)
  const symlinkMappings = [
    { from: 'mac-arm64', to: 'darwin-arm64' },
    { from: 'mac-x64', to: 'darwin-x64' }
  ]

  for (const { from, to } of symlinkMappings) {
    const source = path.join(unpackedBase, from)
    const target = path.join(unpackedBase, to)

    if (fs.existsSync(source) && !fs.existsSync(target)) {
      fs.symlinkSync(from, target, 'dir')
      console.log(`[after-pack] Created symlink: ${to} -> ${from}`)
    }
  }

  // Fix rpath for whisper.node dylib
  const archDir = process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64'
  const addonDir = path.join(unpackedBase, archDir)
  const whisperNode = path.join(addonDir, 'whisper.node')

  if (fs.existsSync(whisperNode)) {
    try {
      execSync(`install_name_tool -add_rpath "${addonDir}" "${whisperNode}" 2>/dev/null || true`)
      console.log(`[after-pack] Added rpath: ${addonDir}`)
    } catch (e) {
      console.warn(`[after-pack] Failed to add rpath: ${e.message}`)
    }
  }

  console.log('[after-pack] macOS whisper-node-addon fixes applied')
}

async function fixWindows(context) {
  const appOutDir = context.appOutDir
  const unpackedBase = path.join(
    appOutDir,
    'resources',
    'app.asar.unpacked',
    'node_modules',
    '@kutalia',
    'whisper-node-addon',
    'dist'
  )

  if (!fs.existsSync(unpackedBase)) {
    console.log('[after-pack] whisper-node-addon dist not found in unpacked asar, skipping')
    return
  }

  // Recreate win-x64 → win32-x64 junction (may be lost during packaging)
  const symlinkMappings = [
    { from: 'win-x64', to: 'win32-x64' }
  ]

  for (const { from, to } of symlinkMappings) {
    const source = path.join(unpackedBase, from)
    const target = path.join(unpackedBase, to)

    if (fs.existsSync(source) && !fs.existsSync(target)) {
      try {
        fs.symlinkSync(source, target, 'junction')
        console.log(`[after-pack] Created junction: ${to} -> ${from}`)
      } catch (e) {
        // Fallback: copy directory
        fs.cpSync(source, target, { recursive: true })
        console.log(`[after-pack] Copied directory: ${from} -> ${to}`)
      }
    }
  }

  console.log('[after-pack] Windows whisper-node-addon fixes applied')
}
