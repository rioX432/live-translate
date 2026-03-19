// After-pack hook for electron-builder:
// Recreate whisper-node-addon symlinks and fix rpath in the unpacked asar directory.
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

exports.default = async function afterPack(context) {
  if (process.platform !== 'darwin') return

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

  console.log('[after-pack] whisper-node-addon fixes applied')
}
