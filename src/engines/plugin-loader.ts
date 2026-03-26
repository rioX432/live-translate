import { app } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, readFileSync } from 'fs'
import type { STTEngine, TranslatorEngine, E2ETranslationEngine } from './types'
import { createLogger } from '../main/logger'

const log = createLogger('plugin-loader')

/** Plugin manifest schema (live-translate-plugin.json) */
export interface PluginManifest {
  name: string
  version: string
  description: string
  engineType: 'stt' | 'translator' | 'e2e'
  engineId: string
  entryPoint: string
  supportedLanguages?: string[]
  author?: string
  homepage?: string
}

export interface LoadedPlugin {
  manifest: PluginManifest
  path: string
}

/** Get the plugins directory */
function getPluginsDir(): string {
  return join(app.getPath('userData'), 'plugins')
}

/** Discover installed plugins by scanning the plugins directory */
export function discoverPlugins(): LoadedPlugin[] {
  const pluginsDir = getPluginsDir()
  if (!existsSync(pluginsDir)) return []

  const plugins: LoadedPlugin[] = []

  for (const dir of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue

    const manifestPath = join(pluginsDir, dir.name, 'live-translate-plugin.json')
    if (!existsSync(manifestPath)) continue

    try {
      const manifest: PluginManifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      if (!validateManifest(manifest)) {
        log.warn(`Invalid manifest in ${dir.name}, skipping`)
        continue
      }

      plugins.push({
        manifest,
        path: join(pluginsDir, dir.name)
      })
    } catch (err) {
      log.warn(`Failed to read manifest in ${dir.name}:`, err)
    }
  }

  return plugins
}

/** Validate a plugin manifest has required fields */
function validateManifest(manifest: unknown): manifest is PluginManifest {
  if (typeof manifest !== 'object' || manifest === null) return false
  const m = manifest as Record<string, unknown>
  return (
    typeof m.name === 'string' &&
    typeof m.version === 'string' &&
    typeof m.engineType === 'string' &&
    ['stt', 'translator', 'e2e'].includes(m.engineType as string) &&
    typeof m.engineId === 'string' &&
    typeof m.entryPoint === 'string'
  )
}

/**
 * Load a plugin's engine factory.
 * WARNING: Plugins execute with full Node.js access. Only install plugins from trusted sources.
 * The entry point must be within the plugin directory (no path traversal).
 */
export async function loadPluginEngine(
  plugin: LoadedPlugin
): Promise<STTEngine | TranslatorEngine | E2ETranslationEngine> {
  const { resolve } = await import('path')
  const { realpathSync } = await import('fs')
  const entryPath = resolve(plugin.path, plugin.manifest.entryPoint)

  if (!existsSync(entryPath)) {
    throw new Error(`Plugin entry point not found: ${entryPath}`)
  }

  // Prevent symlink escapes — resolve real paths
  const realEntry = realpathSync(entryPath)
  const realPlugin = realpathSync(plugin.path)
  if (!realEntry.startsWith(realPlugin)) {
    throw new Error(`Plugin entry point escapes plugin directory via symlink: ${plugin.manifest.entryPoint}`)
  }

  log.warn(`Loading plugin "${plugin.manifest.name}" — plugins run with full system access`)

  const module = await import(entryPath)
  const createEngine = module.default || module.createEngine

  if (typeof createEngine !== 'function') {
    throw new Error(`Plugin ${plugin.manifest.name} does not export a createEngine function`)
  }

  return createEngine()
}

/** List discovered plugins (for settings UI) */
export function listPlugins(): PluginManifest[] {
  return discoverPlugins().map((p) => p.manifest)
}
