/**
 * Samples memory of this process and all its descendants (translator worker,
 * Python ASR server, per-chunk Swift helpers).
 *
 * - RSS sum via `ps` every 200 ms.
 * - phys_footprint via macOS `footprint` about once a second. On Apple Silicon,
 *   Metal/MLX buffers are counted in phys_footprint but not always in RSS, so
 *   the report keeps both and the judgment uses the larger.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface MemSample {
  tMs: number
  rssBytes: number
  footprintBytes: number | null
  pids: number
}

export interface MemSummary {
  peakRssBytes: number
  peakFootprintBytes: number
  /** Sum over processes of footprint's own per-process lifetime peak (upper bound of the tree peak). */
  sumOfProcessPeakFootprintBytes: number
  samples: number
}

async function descendantPids(root: number): Promise<{ pid: number; rss: number }[]> {
  const { stdout } = await execFileAsync('ps', ['-A', '-o', 'pid=,ppid=,rss='])
  const rows = stdout.trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number))
  const children = new Map<number, number[]>()
  const rssOf = new Map<number, number>()
  for (const [pid, ppid, rss] of rows) {
    rssOf.set(pid, rss * 1024)
    if (!children.has(ppid)) children.set(ppid, [])
    children.get(ppid)!.push(pid)
  }
  const out: { pid: number; rss: number }[] = []
  const stack = [root]
  while (stack.length) {
    const p = stack.pop()!
    if (rssOf.has(p)) out.push({ pid: p, rss: rssOf.get(p)! })
    for (const c of children.get(p) ?? []) stack.push(c)
  }
  return out
}

async function footprintOf(pids: number[]): Promise<{ total: number; peaks: Map<number, number> } | null> {
  if (pids.length === 0) return null
  try {
    const { stdout } = await execFileAsync('footprint', ['--noCategories', '-f', 'bytes', ...pids.map(String)], {
      timeout: 5000
    })
    let total = 0
    const peaks = new Map<number, number>()
    let current: number | null = null
    for (const line of stdout.split('\n')) {
      const head = line.match(/\[(\d+)\]: .*Footprint/)
      if (head) current = Number(head[1])
      const fp = line.match(/^\s*phys_footprint: (\d+) B/)
      if (fp) total += Number(fp[1])
      const pk = line.match(/^\s*phys_footprint_peak: (\d+) B/)
      if (pk && current !== null) peaks.set(current, Number(pk[1]))
    }
    return { total, peaks }
  } catch {
    // A short-lived helper can exit between ps and footprint; skip that sample.
    return null
  }
}

export class MemSampler {
  private timer: NodeJS.Timeout | null = null
  private fpTimer: NodeJS.Timeout | null = null
  private fpBusy = false
  private t0 = 0
  readonly samples: MemSample[] = []
  private peakRss = 0
  private peakFootprint = 0
  private processPeaks = new Map<number, number>()
  private lastPids: number[] = []

  start(): void {
    this.t0 = performance.now()
    this.timer = setInterval(() => void this.sampleRss(), 200)
    this.fpTimer = setInterval(() => void this.sampleFootprint(), 1000)
  }

  private async sampleRss(): Promise<void> {
    try {
      const procs = await descendantPids(process.pid)
      const rss = procs.reduce((s, p) => s + p.rss, 0)
      this.lastPids = procs.map((p) => p.pid)
      this.peakRss = Math.max(this.peakRss, rss)
      this.samples.push({ tMs: performance.now() - this.t0, rssBytes: rss, footprintBytes: null, pids: procs.length })
    } catch {
      /* ps can fail transiently under load; the next tick retries */
    }
  }

  private async sampleFootprint(): Promise<void> {
    if (this.fpBusy) return
    this.fpBusy = true
    try {
      const fp = await footprintOf(this.lastPids)
      if (fp) {
        this.peakFootprint = Math.max(this.peakFootprint, fp.total)
        for (const [pid, peak] of fp.peaks) {
          this.processPeaks.set(pid, Math.max(this.processPeaks.get(pid) ?? 0, peak))
        }
        this.samples.push({ tMs: performance.now() - this.t0, rssBytes: 0, footprintBytes: fp.total, pids: this.lastPids.length })
      }
    } finally {
      this.fpBusy = false
    }
  }

  async stop(): Promise<MemSummary> {
    if (this.timer) clearInterval(this.timer)
    if (this.fpTimer) clearInterval(this.fpTimer)
    await this.sampleRss()
    await this.sampleFootprint()
    return {
      peakRssBytes: this.peakRss,
      peakFootprintBytes: this.peakFootprint,
      sumOfProcessPeakFootprintBytes: [...this.processPeaks.values()].reduce((s, v) => s + v, 0),
      samples: this.samples.length
    }
  }
}
