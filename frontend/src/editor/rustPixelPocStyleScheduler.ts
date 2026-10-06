import { RustPixelPocError } from './rustPixelPocError.ts'
import { RUST_STYLE_WORKING_BYTES, rustPixelPocServiceLimits, snapshotRustPixelPocStyleRequest,
  type RustPixelPocServiceLimits, type RustPixelPocServiceRequest } from './rustPixelPocStyleInput.ts'
import { RustPixelPocStyleService, type RustPixelPocConnect, type RustPixelPocResultLease } from './rustPixelPocStyleService.ts'
import { RustPixelPocStyleCancelledError } from './rustPixelPocStyleSession.ts'

export interface RustPixelPocSchedulerLimits extends RustPixelPocServiceLimits { maxPendingConsumers?: number }
type Ticket = ReturnType<typeof snapshotRustPixelPocStyleRequest> & {
  consumerId: string; settled: boolean
  resolve: (lease: RustPixelPocResultLease) => void; reject: (error: unknown) => void
}

/** One shared service, FIFO consumers and one latest pending job per consumer. */
export class RustPixelPocStyleScheduler {
  private readonly service: RustPixelPocStyleService
  private readonly limits: Required<RustPixelPocServiceLimits>
  private readonly maxPendingConsumers: number
  private readonly pending = new Map<string, Ticket>()
  private active: Ticket | null = null
  private stopped = false
  private disposal: Promise<void> | null = null
  private sourceKey: { consumerId: string; identity: string } | null = null
  private sourceVersion = 0

  constructor(connect: RustPixelPocConnect, limits: RustPixelPocSchedulerLimits = {}) {
    this.limits = rustPixelPocServiceLimits(limits)
    this.maxPendingConsumers = limits.maxPendingConsumers ?? 16
    if (!Number.isSafeInteger(this.maxPendingConsumers) || this.maxPendingConsumers < 1 || this.maxPendingConsumers > 64) {
      throw new RustPixelPocError('invalid-input')
    }
    this.service = new RustPixelPocStyleService(connect, this.limits)
  }

  get stats() {
    const service = this.service.stats
    const inputBytes = this.active?.inputBytes ?? 0
    const workingBytes = service.active ? RUST_STYLE_WORKING_BYTES : service.sourceBytes
    return { ...service, active: Number(!!this.active), pending: this.pending.size,
      queuedInputBytes: this.queuedBytes(), reservedBytes: workingBytes + inputBytes + service.retainedResultBytes + this.queuedBytes(), disposed: this.stopped }
  }

  render(consumerId: string, input: RustPixelPocServiceRequest): Promise<RustPixelPocResultLease> {
    if (this.stopped) return Promise.reject(new RustPixelPocError('wasm-unavailable'))
    if (typeof consumerId !== 'string' || !consumerId || consumerId.length > 512) {
      return Promise.reject(new RustPixelPocError('invalid-input'))
    }
    const previous = this.pending.get(consumerId)
    if (previous) this.reject(previous, new RustPixelPocStyleCancelledError())
    this.cancelActive(consumerId)
    try {
      const prepared = snapshotRustPixelPocStyleRequest(input)
      prepared.inputBytes += consumerId.length * 2
      const queued = this.queuedBytes() - (previous?.inputBytes ?? 0)
      if (!previous && this.pending.size >= this.maxPendingConsumers ||
          this.stats.reservedBytes - (previous?.inputBytes ?? 0) + prepared.inputBytes > this.limits.maxResidentBytes ||
          RUST_STYLE_WORKING_BYTES + this.service.stats.retainedResultBytes + queued + prepared.inputBytes > this.limits.maxResidentBytes) {
        throw new RustPixelPocError('memory-limit')
      }
      const promise = new Promise<RustPixelPocResultLease>((resolve, reject) => {
        // Replacing a queued job keeps its position ahead of newer consumers.
        this.pending.set(consumerId, { ...prepared, consumerId, settled: false, resolve, reject })
      })
      this.pump()
      return promise
    } catch (error) {
      if (previous) this.pending.delete(consumerId)
      return Promise.reject(error instanceof RustPixelPocError ? error : new RustPixelPocError('invalid-input'))
    }
  }

  cancel(consumerId: string) {
    const pending = this.pending.get(consumerId)
    if (pending) { this.reject(pending, new RustPixelPocStyleCancelledError()); this.pending.delete(consumerId) }
    this.cancelActive(consumerId)
  }

  dispose() {
    if (this.disposal) return this.disposal
    this.stopped = true
    this.rejectPending(new RustPixelPocStyleCancelledError())
    if (this.active) this.reject(this.active, new RustPixelPocStyleCancelledError())
    this.sourceKey = null
    this.disposal = this.service.dispose().then(() => this.service.whenIdle())
    return this.disposal
  }

  private queuedBytes() { return [...this.pending.values()].reduce((sum, ticket) => sum + ticket.inputBytes, 0) }

  private reject(ticket: Ticket, error: unknown) {
    if (!ticket.settled) { ticket.settled = true; ticket.reject(error) }
  }

  private rejectPending(error: unknown) {
    for (const ticket of this.pending.values()) this.reject(ticket, error)
    this.pending.clear()
  }

  private cancelActive(consumerId: string) {
    if (this.active?.consumerId !== consumerId || this.active.settled) return
    this.reject(this.active, new RustPixelPocStyleCancelledError())
    this.service.cancel()
  }

  private pump() {
    if (this.active || this.stopped) return
    while (this.pending.size) {
      const ticket = this.pending.values().next().value!
      this.pending.delete(ticket.consumerId)
      if (RUST_STYLE_WORKING_BYTES + ticket.inputBytes + this.queuedBytes() + this.service.stats.retainedResultBytes > this.limits.maxResidentBytes) {
        this.reject(ticket, new RustPixelPocError('memory-limit'))
        continue
      }
      this.active = ticket
      void this.run(ticket)
      return
    }
  }

  private async run(ticket: Ticket) {
    try {
      const identity = ticket.request.sourceIdentity
      if (this.sourceKey?.consumerId !== ticket.consumerId || this.sourceKey.identity !== identity) {
        this.sourceKey = { consumerId: ticket.consumerId, identity }; this.sourceVersion++
      }
      const lease = await this.service.render({ ...ticket.request, sourceIdentity: `scheduler-source:${this.sourceVersion}` })
      if (ticket.settled || this.stopped) { lease.release(); return }
      if (this.stats.reservedBytes > this.limits.maxResidentBytes) {
        lease.release(); throw new RustPixelPocError('memory-limit')
      }
      ticket.settled = true
      ticket.resolve(lease)
    } catch (error) { this.reject(ticket, error) }
    finally {
      // Cancellation rejects early; wait for the old Worker job before dispatching another consumer.
      try { await this.service.whenIdle() }
      catch {
        this.stopped = true
        this.rejectPending(new RustPixelPocError('wasm-unavailable'))
        void this.service.dispose().catch(() => {})
      }
      if (this.active === ticket) this.active = null
      this.pump()
    }
  }
}
