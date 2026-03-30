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
      const raw: unknown = JSON.parse(readFileSync(manifestPath, 'utf-8'))
      const error = validateManifest(raw)
      if (error) {
        log.warn(`Invalid manifest in ${dir.name}: ${error}`)
        continue
      }
      const manifest = raw as PluginManifest

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

const VALID_ENGINE_TYPES = ['stt', 'translator', 'e2e'] as const
const VERSION_RE = /^\d+\.\d+\.\d+/
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/

/**
 * Validate a plugin manifest has required fields with correct types.
 * Returns null on success, or a human-readable error string on failure.
 */
export function validateManifest(manifest: unknown): string | null {
  if (typeof manifest !== 'object' || manifest === null || Array.isArray(manifest)) {
    return 'Manifest must be a non-null object'
  }

  const m = manifest as Record<string, unknown>

  // Required string fields
  const requiredStrings: Array<{ key: string; label: string }> = [
    { key: 'name', label: 'name' },
    { key: 'version', label: 'version' },
    { key: 'description', label: 'description' },
    { key: 'engineId', label: 'engineId' },
    { key: 'entryPoint', label: 'entryPoint' }
  ]

  for (const { key, label } of requiredStrings) {
    if (typeof m[key] !== 'string') return `"${label}" must be a string`
    if ((m[key] as string).trim().length === 0) return `"${label}" must not be empty`
  }

  // Version format
  if (!VERSION_RE.test(m.version as string)) {
    return '"version" must follow semver (e.g. "1.0.0")'
  }

  // engineType enum
  if (typeof m.engineType !== 'string') return '"engineType" must be a string'
  if (!(VALID_ENGINE_TYPES as readonly string[]).includes(m.engineType as string)) {
    return `"engineType" must be one of: ${VALID_ENGINE_TYPES.join(', ')}`
  }

  // engineId must be safe (no special chars)
  if (!SAFE_ID_RE.test(m.engineId as string)) {
    return '"engineId" must contain only alphanumeric characters, hyphens, or underscores'
  }

  // entryPoint must not contain path traversal
  const entry = m.entryPoint as string
  if (entry.includes('..') || entry.startsWith('/') || entry.startsWith('\\')) {
    return '"entryPoint" must be a relative path without traversal'
  }

  // Optional: supportedLanguages
  if (m.supportedLanguages !== undefined) {
    if (!Array.isArray(m.supportedLanguages)) {
      return '"supportedLanguages" must be an array of strings'
    }
    for (const lang of m.supportedLanguages) {
      if (typeof lang !== 'string' || lang.trim().length === 0) {
        return '"supportedLanguages" must contain only non-empty strings'
      }
    }
  }

  // Optional string fields
  for (const key of ['author', 'homepage']) {
    if (m[key] !== undefined && typeof m[key] !== 'string') {
      return `"${key}" must be a string if provided`
    }
  }

  return null
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
