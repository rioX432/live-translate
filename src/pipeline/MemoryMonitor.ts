import { createLogger } from '../main/logger'

const log = createLogger('memory')

/**
 * Periodically logs process memory usage.
 * Extracted from TranslationPipeline to isolate monitoring concerns.
 */
export class MemoryMonitor {
  private timer: ReturnType<typeof setInterval> | null = null
  private startedAt: number | null = null

  get sessionStartTime(): number | null {
    return this.startedAt
  }

  start(): void {
    this.stop()
    this.startedAt = Date.now()
    this.logMemoryUsage()
    this.timer = setInterval(() => this.logMemoryUsage(), 60_000)
    if (typeof this.timer === 'object' && 'unref' in this.timer) {
      this.timer.unref()
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.startedAt = null
  }

  private logMemoryUsage(): void {
    const mem = process.memoryUsage()
    const mb = (bytes: number): string => (bytes / 1024 / 1024).toFixed(1)
    const elapsed = this.startedAt
      ? `${((Date.now() - this.startedAt) / 60_000).toFixed(1)}min`
      : '0min'
    log.info(`elapsed=${elapsed} heap=${mb(mem.heapUsed)}/${mb(mem.heapTotal)}MB rss=${mb(mem.rss)}MB external=${mb(mem.external)}MB`)
  }
}
