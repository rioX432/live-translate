import { statSync } from 'fs'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { validatePathWithinDir } from './ipc-validators'

/** Handler for the vad-asset:// scheme, which serves VAD assets from vadDir */
export function createVadAssetHandler(
  vadDir: string,
  fetchFile: (fileUrl: string) => Promise<Response>
): (request: Request) => Promise<Response> {
  return async (request) => {
    // The URL parser collapses a literal ../, but %2F- or %5C-separated segments only appear after decoding,
    // so the decoded path is checked against vadDir (symlinks resolved) before anything is read
    let filename: string
    try {
      filename = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, '')
    } catch {
      return new Response(null, { status: 400 })
    }
    const checked = validatePathWithinDir(join(vadDir, filename), vadDir)
    if ('error' in checked || !statSync(checked.path).isFile()) return new Response(null, { status: 404 })
    return fetchFile(pathToFileURL(checked.path).href)
  }
}
