/**
 * Simple script to generate placeholder extension icons.
 * Run with: node generate-icons.js
 *
 * Creates 16x16, 48x48, and 128x128 PNG icons.
 * Requires no dependencies — generates minimal valid PNG files.
 */

const fs = require('fs')
const zlib = require('zlib')

function createPNG(size) {
  // Create RGBA pixel data — blue circle on transparent background
  const pixels = Buffer.alloc(size * size * 4, 0)
  const center = size / 2
  const radius = size * 0.4

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - center
      const dy = y - center
      const dist = Math.sqrt(dx * dx + dy * dy)

      const idx = (y * size + x) * 4
      if (dist <= radius) {
        // Blue (#3b82f6)
        pixels[idx] = 59
        pixels[idx + 1] = 130
        pixels[idx + 2] = 246
        pixels[idx + 3] = 255
      }
    }
  }

  // Build PNG file
  // Filter each row with "None" filter (0x00)
  const rawData = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    rawData[y * (size * 4 + 1)] = 0 // filter byte
    pixels.copy(rawData, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }

  const compressed = zlib.deflateSync(rawData)

  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  // IHDR chunk
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(size, 0) // width
  ihdrData.writeUInt32BE(size, 4) // height
  ihdrData[8] = 8 // bit depth
  ihdrData[9] = 6 // color type (RGBA)
  ihdrData[10] = 0 // compression
  ihdrData[11] = 0 // filter
  ihdrData[12] = 0 // interlace
  const ihdr = makeChunk('IHDR', ihdrData)

  // IDAT chunk
  const idat = makeChunk('IDAT', compressed)

  // IEND chunk
  const iend = makeChunk('IEND', Buffer.alloc(0))

  return Buffer.concat([signature, ihdr, idat, iend])
}

function makeChunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const typeBuffer = Buffer.from(type, 'ascii')
  const crcInput = Buffer.concat([typeBuffer, data])

  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(crcInput), 0)

  return Buffer.concat([length, typeBuffer, data, crc])
}

function crc32(buf) {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

// Generate icons
for (const size of [16, 48, 128]) {
  const png = createPNG(size)
  fs.writeFileSync(`icon${size}.png`, png)
  console.log(`Generated icon${size}.png (${png.length} bytes)`)
}
