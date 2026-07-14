/**
 * Non-blocking counting semaphore for the shadow measurement harness.
 *
 * The shadow runner uses a "drop-if-busy" policy rather than queuing: when no
 * permit is available the caller drops the sample instead of waiting. Queuing
 * would fold wait time into measured latency and corrupt the telemetry, so this
 * semaphore intentionally exposes only a synchronous {@link tryAcquire} — there
 * is no blocking acquire.
 */
export class Semaphore {
  private available: number

  constructor(private readonly permits: number) {
    if (permits < 1) throw new Error(`Semaphore permits must be >= 1, got ${permits}`)
    this.available = permits
  }

  /** Attempt to take a permit without waiting. Returns true if one was acquired. */
  tryAcquire(): boolean {
    if (this.available > 0) {
      this.available--
      return true
    }
    return false
  }

  /** Return a permit. Never exceeds the configured maximum. */
  release(): void {
    if (this.available < this.permits) {
      this.available++
    }
  }

  get availablePermits(): number {
    return this.available
  }
}
