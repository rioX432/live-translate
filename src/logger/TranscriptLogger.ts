import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync, appendFileSync, writeFileSync } from 'fs'
import type { TranslationResult } from '../engines/types'

export class TranscriptLogger {
  private logPath: string
  private sessionStartTime: Date

  constructor() {
    const logsDir = join(app.getPath('documents'), 'live-translate', 'logs')
    if (!existsSync(logsDir)) {
      mkdirSync(logsDir, { recursive: true })
    }

    this.sessionStartTime = new Date()
    const timestamp = this.sessionStartTime
      .toISOString()
      .replace(/[:.]/g, '-')
      .slice(0, 19)
    this.logPath = join(logsDir, `${timestamp}.txt`)
  }

  /** Write session header */
  startSession(engineMode: string): void {
    const header = [
      `=== live-translate Session Log ===`,
      `Date: ${this.sessionStartTime.toLocaleDateString('ja-JP')} ${this.sessionStartTime.toLocaleTimeString('ja-JP')}`,
      `Engine: ${engineMode}`,
      `${'='.repeat(40)}`,
      ''
    ].join('\n')

    writeFileSync(this.logPath, header, 'utf-8')
  }

  /** Append a translation result to the log */
  log(result: TranslationResult): void {
    const time = new Date(result.timestamp).toLocaleTimeString('ja-JP')
    const entry = [
      `[${time}] [${result.sourceLanguage.toUpperCase()}] ${result.sourceText}`,
      `[${time}] [${result.targetLanguage.toUpperCase()}] ${result.translatedText}`,
      ''
    ].join('\n')

    appendFileSync(this.logPath, entry, 'utf-8')
  }

  /** Write session footer */
  endSession(): void {
    const endTime = new Date()
    const duration = Math.round((endTime.getTime() - this.sessionStartTime.getTime()) / 1000)
    const footer = [
      `${'='.repeat(40)}`,
      `Session ended: ${endTime.toLocaleTimeString('ja-JP')}`,
      `Duration: ${Math.floor(duration / 60)}m ${duration % 60}s`,
      ''
    ].join('\n')

    appendFileSync(this.logPath, footer, 'utf-8')
  }

  /** Get the log file path */
  getLogPath(): string {
    return this.logPath
  }
}
