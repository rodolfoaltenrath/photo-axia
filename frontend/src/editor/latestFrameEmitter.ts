export interface FrameScheduler {
  cancel: (handle: number) => void
  schedule: (callback: () => void) => number
}

const browserFrameScheduler: FrameScheduler = {
  cancel: (handle) => cancelAnimationFrame(handle),
  schedule: (callback) => requestAnimationFrame(callback)
}

/**
 * Sends at most one value per animation frame and applies backpressure while
 * an asynchronous consumer is busy. Intermediate values are replaced by the
 * latest one, which is exactly what an interactive preview needs.
 */
export class LatestFrameEmitter<Value> {
  private readonly emit: (value: Value) => Promise<unknown>
  private frame: number | undefined
  private inFlight = false
  private pending: Value | undefined
  private readonly scheduler: FrameScheduler
  private stopped = false

  constructor(
    emit: (value: Value) => Promise<unknown>,
    scheduler: FrameScheduler = browserFrameScheduler
  ) {
    this.emit = emit
    this.scheduler = scheduler
  }

  enqueue(value: Value) {
    if (this.stopped) return
    this.pending = value
    this.schedule()
  }

  clear() {
    this.pending = undefined
    if (this.frame !== undefined) {
      this.scheduler.cancel(this.frame)
      this.frame = undefined
    }
  }

  stop() {
    this.stopped = true
    this.clear()
  }

  private schedule() {
    if (this.frame !== undefined || this.inFlight || this.pending === undefined || this.stopped) return
    this.frame = this.scheduler.schedule(() => {
      this.frame = undefined
      void this.drain()
    })
  }

  private async drain() {
    if (this.inFlight || this.pending === undefined || this.stopped) return
    const value = this.pending
    this.pending = undefined
    this.inFlight = true
    try {
      await this.emit(value)
    } catch {
      // A closed native window can terminate the bridge while a preview is in
      // flight. The final Apply event has its own payload, so a preview failure
      // must not become an unhandled rejection or block subsequent sessions.
    } finally {
      this.inFlight = false
      this.schedule()
    }
  }
}
