import type { LatencyStats, MemorySnapshot } from './types.js'

/** Measure execution time of an async function in milliseconds */
export async function measureLatency<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now()
  const result = await fn()
  const ms = performance.now() - start
  return { result, ms }
}

/** Take a memory snapshot using process.memoryUsage() */
export function snapshotMemory(): MemorySnapshot {
  const mem = process.memoryUsage()
  return {
    heapUsedMB: mem.heapUsed / 1024 / 1024,
    rssMB: mem.rss / 1024 / 1024,
    externalMB: mem.external / 1024 / 1024,
    timestamp: Date.now()
  }
}

/** Force garbage collection if --expose-gc flag is enabled */
export function tryGC(): void {
  if (typeof globalThis.gc === 'function') {
    globalThis.gc()
  }
}

/** Compute latency statistics from an array of millisecond values */
export function computeStats(values: number[]): LatencyStats {
  if (values.length === 0) {
    return { avg: 0, median: 0, p95: 0, min: 0, max: 0 }
  }

  const sorted = [...values].sort((a, b) => a - b)
  const sum = sorted.reduce((acc, v) => acc + v, 0)
  const avg = sum / sorted.length
  const median = sorted[Math.floor(sorted.length / 2)]!
  const p95Index = Math.min(Math.ceil(sorted.length * 0.95) - 1, sorted.length - 1)
  const p95 = sorted[p95Index]!
  const min = sorted[0]!
  const max = sorted[sorted.length - 1]!

  return { avg, median, p95, min, max }
}
