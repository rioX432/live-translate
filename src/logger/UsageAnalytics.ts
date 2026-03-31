import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { listSessions } from './SessionManager'
import { createLogger } from '../main/logger'

const log = createLogger('usage-analytics')

/** Aggregated usage statistics for a single day */
export interface DailyUsageStats {
  date: string // YYYY-MM-DD
  totalSessionCount: number
  totalDurationMs: number
  totalCharacterCount: number
  engineUsage: Record<string, number> // engineMode -> session count
  languagePairs: Record<string, number> // "ja->en" -> count
}

/** Summary analytics across a date range */
export interface UsageSummary {
  periodStart: string // YYYY-MM-DD
  periodEnd: string // YYYY-MM-DD
  totalSessions: number
  totalDurationMs: number
  totalCharacters: number
  averageSessionDurationMs: number
  engineBreakdown: Record<string, number>
  languagePairBreakdown: Record<string, number>
  dailyStats: DailyUsageStats[]
}

/** Current session tracking data (updated in real-time) */
export interface LiveSessionMetrics {
  sessionId: string
  startedAt: number
  characterCount: number
  engineMode: string
  sourceLanguage: string
  targetLanguage: string
}

function getAnalyticsDir(): string {
  const dir = join(app.getPath('userData'), 'analytics')
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }
  return dir
}

function getDailyStatsPath(date: string): string {
  return join(getAnalyticsDir(), `${date}.json`)
}

/** Sanitize date string to prevent path traversal */
function sanitizeDate(date: string): string {
  return date.replace(/[^0-9\-]/g, '').slice(0, 10)
}

/** Get today's date in YYYY-MM-DD format */
function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Load daily stats for a given date, or return empty stats */
function loadDailyStats(date: string): DailyUsageStats {
  const path = getDailyStatsPath(sanitizeDate(date))
  if (existsSync(path)) {
    try {
      return JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      log.warn('Failed to parse daily stats for', date)
    }
  }
  return {
    date: sanitizeDate(date),
    totalSessionCount: 0,
    totalDurationMs: 0,
    totalCharacterCount: 0,
    engineUsage: {},
    languagePairs: {}
  }
}

/** Save daily stats */
function saveDailyStats(stats: DailyUsageStats): void {
  const path = getDailyStatsPath(sanitizeDate(stats.date))
  try {
    writeFileSync(path, JSON.stringify(stats, null, 2))
  } catch (err) {
    log.error('Failed to save daily stats:', err)
  }
}

/** Record a completed session into daily analytics */
export function recordSessionEnd(metrics: LiveSessionMetrics): void {
  const date = today()
  const stats = loadDailyStats(date)

  const durationMs = Date.now() - metrics.startedAt

  stats.totalSessionCount++
  stats.totalDurationMs += durationMs
  stats.totalCharacterCount += metrics.characterCount

  // Track engine usage
  const engine = metrics.engineMode || 'unknown'
  stats.engineUsage[engine] = (stats.engineUsage[engine] || 0) + 1

  // Track language pair
  if (metrics.sourceLanguage && metrics.targetLanguage) {
    const pair = `${metrics.sourceLanguage}->${metrics.targetLanguage}`
    stats.languagePairs[pair] = (stats.languagePairs[pair] || 0) + 1
  }

  saveDailyStats(stats)
  log.info(`Session recorded: ${durationMs}ms, ${metrics.characterCount} chars, ${engine}`)
}

/** Increment character count for a live session */
export function incrementCharacterCount(metrics: LiveSessionMetrics, charCount: number): void {
  metrics.characterCount += charCount
}

/** Get usage summary for a date range (last N days) */
export function getUsageSummary(days: number = 30): UsageSummary {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - days)

  const dailyStats: DailyUsageStats[] = []
  const engineBreakdown: Record<string, number> = {}
  const languagePairBreakdown: Record<string, number> = {}
  let totalSessions = 0
  let totalDurationMs = 0
  let totalCharacters = 0

  // Iterate through each day in the range
  const current = new Date(start)
  while (current <= end) {
    const dateStr = current.toISOString().slice(0, 10)
    const stats = loadDailyStats(dateStr)

    if (stats.totalSessionCount > 0) {
      dailyStats.push(stats)
      totalSessions += stats.totalSessionCount
      totalDurationMs += stats.totalDurationMs
      totalCharacters += stats.totalCharacterCount

      for (const [engine, count] of Object.entries(stats.engineUsage)) {
        engineBreakdown[engine] = (engineBreakdown[engine] || 0) + count
      }
      for (const [pair, count] of Object.entries(stats.languagePairs)) {
        languagePairBreakdown[pair] = (languagePairBreakdown[pair] || 0) + count
      }
    }

    current.setDate(current.getDate() + 1)
  }

  return {
    periodStart: start.toISOString().slice(0, 10),
    periodEnd: end.toISOString().slice(0, 10),
    totalSessions,
    totalDurationMs,
    totalCharacters,
    averageSessionDurationMs: totalSessions > 0 ? Math.round(totalDurationMs / totalSessions) : 0,
    engineBreakdown,
    languagePairBreakdown,
    dailyStats
  }
}

/** Quick stats: total sessions and total duration from session metadata */
export function getQuickStats(): { totalSessions: number; totalDurationMs: number } {
  const sessions = listSessions()
  let totalDurationMs = 0
  for (const s of sessions) {
    if (s.durationMs) {
      totalDurationMs += s.durationMs
    }
  }
  return { totalSessions: sessions.length, totalDurationMs }
}
