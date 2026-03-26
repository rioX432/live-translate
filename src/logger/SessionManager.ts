import { app } from 'electron'
import { join } from 'path'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  unlinkSync
} from 'fs'
import { appendFile } from 'fs/promises'
import type { TranslationResult } from '../engines/types'
import { createLogger } from '../main/logger'

const log = createLogger('session-manager')

export interface SessionMetadata {
  id: string
  startedAt: number
  endedAt?: number
  engineMode: string
  durationMs?: number
  entryCount: number
}

export interface SessionEntry {
  timestamp: number
  sourceText: string
  translatedText: string
  sourceLanguage: string
  targetLanguage: string
  speakerId?: string
}

export interface SessionData {
  metadata: SessionMetadata
  entries: SessionEntry[]
}

function getSessionsDir(): string {
  const dir = join(app.getPath('documents'), 'live-translate', 'sessions')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

/** Sanitize session ID to prevent path traversal */
function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9\-_T]/g, '')
}

function sessionFilePath(id: string): string {
  return join(getSessionsDir(), `${sanitizeId(id)}.json`)
}

/** Create a new session and return its ID */
export function createSession(engineMode: string): string {
  const id = new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')
  const data: SessionData = {
    metadata: {
      id,
      startedAt: Date.now(),
      engineMode,
      entryCount: 0
    },
    entries: []
  }
  writeFileSync(sessionFilePath(id), JSON.stringify(data, null, 2))
  return id
}

/** Append a translation result to the session (append-only for performance) */
export async function appendEntry(sessionId: string, result: TranslationResult): Promise<void> {
  const entriesPath = sessionFilePath(sessionId).replace('.json', '.entries.jsonl')

  const entry: SessionEntry = {
    timestamp: result.timestamp,
    sourceText: result.sourceText,
    translatedText: result.translatedText,
    sourceLanguage: result.sourceLanguage,
    targetLanguage: result.targetLanguage,
    speakerId: result.speakerId
  }

  try {
    await appendFile(entriesPath, JSON.stringify(entry) + '\n', 'utf-8')
  } catch (err) {
    log.error('Failed to append entry:', err)
  }
}

/** End a session — merge JSONL entries into the JSON file */
export function endSession(sessionId: string): void {
  const path = sessionFilePath(sessionId)
  const entriesPath = path.replace('.json', '.entries.jsonl')
  if (!existsSync(path)) return

  try {
    const data: SessionData = JSON.parse(readFileSync(path, 'utf-8'))
    data.metadata.endedAt = Date.now()
    data.metadata.durationMs = Date.now() - data.metadata.startedAt

    // Merge JSONL entries
    if (existsSync(entriesPath)) {
      const lines = readFileSync(entriesPath, 'utf-8').split('\n').filter((l) => l.trim())
      data.entries = lines.map((l) => JSON.parse(l) as SessionEntry)
      data.metadata.entryCount = data.entries.length
      unlinkSync(entriesPath)
    }

    writeFileSync(path, JSON.stringify(data, null, 2))
  } catch (err) {
    log.error('Failed to end session:', err)
  }
}

/** List all sessions (metadata only) */
export function listSessions(): SessionMetadata[] {
  const dir = getSessionsDir()
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse()
  return files.map((f) => {
    try {
      const data: SessionData = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
      return data.metadata
    } catch {
      return null
    }
  }).filter(Boolean) as SessionMetadata[]
}

/** Load a full session */
export function loadSession(sessionId: string): SessionData | null {
  const path = sessionFilePath(sessionId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

/** Search across all sessions (limited to most recent 50 sessions, max 100 matches) */
export function searchSessions(query: string): Array<{ sessionId: string; matches: SessionEntry[] }> {
  const dir = getSessionsDir()
  const files = readdirSync(dir).filter((f) => f.endsWith('.json')).sort().reverse().slice(0, 50)
  const lower = query.toLowerCase()
  const results: Array<{ sessionId: string; matches: SessionEntry[] }> = []
  let totalMatches = 0

  for (const f of files) {
    if (totalMatches >= 100) break
    try {
      const data: SessionData = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
      const matches = data.entries.filter(
        (e) =>
          e.sourceText.toLowerCase().includes(lower) ||
          e.translatedText.toLowerCase().includes(lower)
      )
      if (matches.length > 0) {
        results.push({ sessionId: data.metadata.id, matches })
        totalMatches += matches.length
      }
    } catch { /* skip corrupted files */ }
  }

  return results
}

/** Delete a session */
export function deleteSession(sessionId: string): void {
  const path = sessionFilePath(sessionId)
  if (existsSync(path)) {
    unlinkSync(path)
  }
}

/** Delete sessions older than retention days */
export function cleanupSessions(retentionDays: number): number {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
  const sessions = listSessions()
  let deleted = 0

  for (const s of sessions) {
    if (s.startedAt < cutoff) {
      deleteSession(s.id)
      deleted++
    }
  }

  return deleted
}

/** Export session as plain text */
export function exportAsText(data: SessionData): string {
  const lines = [
    `=== Session: ${data.metadata.id} ===`,
    `Engine: ${data.metadata.engineMode}`,
    `Duration: ${data.metadata.durationMs ? Math.round(data.metadata.durationMs / 1000) + 's' : 'N/A'}`,
    ''
  ]
  for (const e of data.entries) {
    const time = new Date(e.timestamp).toLocaleTimeString()
    const speaker = e.speakerId ? `[${e.speakerId}] ` : ''
    lines.push(`[${time}] ${speaker}[${e.sourceLanguage.toUpperCase()}] ${e.sourceText}`)
    lines.push(`[${time}] ${speaker}[${e.targetLanguage.toUpperCase()}] ${e.translatedText}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** Export session as SRT subtitle format */
export function exportAsSRT(data: SessionData): string {
  return data.entries.map((e, i) => {
    const start = formatSrtTime(e.timestamp - data.metadata.startedAt)
    const end = formatSrtTime(e.timestamp - data.metadata.startedAt + 3000)
    return `${i + 1}\n${start} --> ${end}\n${e.sourceText}\n${e.translatedText}\n`
  }).join('\n')
}

function formatSrtTime(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const msec = ms % 1000
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(msec).padStart(3, '0')}`
}

/** Export session as Markdown */
export function exportAsMarkdown(data: SessionData): string {
  const lines = [
    `# Session: ${data.metadata.id}`,
    '',
    `- **Engine:** ${data.metadata.engineMode}`,
    `- **Duration:** ${data.metadata.durationMs ? Math.round(data.metadata.durationMs / 1000) + 's' : 'N/A'}`,
    `- **Entries:** ${data.metadata.entryCount}`,
    '',
    '| Time | Speaker | Source | Translation |',
    '|------|---------|--------|-------------|'
  ]
  for (const e of data.entries) {
    const time = new Date(e.timestamp).toLocaleTimeString()
    const speaker = e.speakerId ?? ''
    lines.push(`| ${time} | ${speaker} | ${e.sourceText} | ${e.translatedText} |`)
  }
  return lines.join('\n')
}
