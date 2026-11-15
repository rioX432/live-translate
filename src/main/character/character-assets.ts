import { app } from 'electron'
import { randomBytes } from 'crypto'
import { mkdir, open, readFile, rm, stat, writeFile } from 'fs/promises'
import { join, resolve, sep } from 'path'
import { isSafeAssetFileName, CUSTOM_PROFILE_ID_PATTERN } from '../../shared/character/settings'
import type { CharacterState, ImageExtension } from '../../shared/character/types'

/** Large images would bloat the settings round trip (assets travel as data URLs) */
export const MAX_CHARACTER_IMAGE_BYTES = 2 * 1024 * 1024

const MIME: Record<ImageExtension, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp'
}

export const IMPORT_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp']

function charactersRoot(): string {
  return join(app.getPath('userData'), 'characters')
}

/** Resolve a profile directory, refusing anything that is not a generated custom id */
export function profileDir(profileId: string): string {
  if (!CUSTOM_PROFILE_ID_PATTERN.test(profileId)) throw new Error('Invalid character id')
  const root = resolve(charactersRoot())
  const dir = resolve(root, profileId)
  if (!dir.startsWith(root + sep)) throw new Error('Invalid character id')
  return dir
}

function assetPath(profileId: string, fileName: string): string {
  if (!isSafeAssetFileName(fileName)) throw new Error('Invalid asset name')
  const dir = profileDir(profileId)
  const file = resolve(dir, fileName)
  if (!file.startsWith(dir + sep)) throw new Error('Invalid asset name')
  return file
}

/** Detect the real image type from magic bytes; the file extension is not trusted */
export function sniffImageType(head: Uint8Array): ImageExtension | null {
  const b = head
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'png'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b.length >= 6) {
    const sig = String.fromCharCode(...b.slice(0, 6))
    if (sig === 'GIF87a' || sig === 'GIF89a') return 'gif'
  }
  if (b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === 'RIFF' &&
      String.fromCharCode(...b.slice(8, 12)) === 'WEBP') return 'webp'
  return null
}

export type ImportResult = { fileName: string } | { error: string }

/** Copy a user-picked image into the profile directory under a generated name */
export async function importCharacterImage(
  sourcePath: string,
  profileId: string,
  state: CharacterState
): Promise<ImportResult> {
  const info = await stat(sourcePath)
  if (!info.isFile()) return { error: 'Not a file' }
  if (info.size > MAX_CHARACTER_IMAGE_BYTES) return { error: 'Image is larger than 2 MB' }

  const handle = await open(sourcePath, 'r')
  let head: Uint8Array
  try {
    const buf = Buffer.alloc(12)
    const { bytesRead } = await handle.read(buf, 0, 12, 0)
    head = buf.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
  const ext = sniffImageType(head)
  if (!ext) return { error: 'Use a PNG, JPEG, GIF, or WebP image' }

  const data = await readFile(sourcePath)
  if (data.length > MAX_CHARACTER_IMAGE_BYTES) return { error: 'Image is larger than 2 MB' }

  const fileName = `${state}-${randomBytes(4).toString('hex')}.${ext}`
  await mkdir(profileDir(profileId), { recursive: true })
  await writeFile(assetPath(profileId, fileName), data)
  return { fileName }
}

export async function removeCharacterAsset(profileId: string, fileName: string): Promise<void> {
  await rm(assetPath(profileId, fileName), { force: true })
}

export async function removeProfileAssets(profileId: string): Promise<void> {
  await rm(profileDir(profileId), { recursive: true, force: true })
}

/** Read a profile's images as data URLs; missing or unreadable files are skipped */
export async function readCharacterAssets(
  profileId: string,
  assets: Partial<Record<CharacterState, string>>
): Promise<Partial<Record<CharacterState, string>>> {
  const out: Partial<Record<CharacterState, string>> = {}
  for (const [state, fileName] of Object.entries(assets) as Array<[CharacterState, string]>) {
    try {
      const data = await readFile(assetPath(profileId, fileName))
      const ext = sniffImageType(data.subarray(0, 12))
      if (ext) out[state] = `data:${MIME[ext]};base64,${data.toString('base64')}`
    } catch {
      // A deleted file falls back to the idle image in the renderer
    }
  }
  return out
}

export function newCustomProfileId(): string {
  return `custom-${randomBytes(6).toString('hex')}`
}
