import { RustPixelPocError } from './rustPixelPocError.ts'
import { RUST_STYLE_WORKING_BYTES, rustPixelPocServiceLimits, snapshotRustPixelPocStyleRequest,
  type RustPixelPocServiceLimits, type RustPixelPocServiceRequest } from './rustPixelPocStyleInput.ts'
import { RustPixelPocStyleService, type RustPixelPocConnect, type RustPixelPocResultLease } from './rustPixelPocStyleService.ts'
import { RustPixelPocStyleCancelledError } from './rustPixelPocStyleSession.ts'
import { rustStylePriorityValid, type RustStylePriority } from './rustStyleScheduling.ts'

export interface RustPixelPocSchedulerLimits extends RustPixelPocServiceLimits { maxPendingConsumers?: number }
export interface RustPixelPocSchedulingOptions { priority?: RustStylePriority }
export interface RustPixelPocScheduledPreparation {
  inputBytes: number
  prepare(signal: AbortSignal): Promise<RustPixelPocServiceRequest>
}
const PREPARATION_BYTES = 128 * 1024 * 1024
const MAX_PRIORITY_BYPASSES = 3
type Ticket = {
  request?: RustPixelPocServiceRequest; preparation?: RustPixelPocScheduledPreparation; inputBytes: number
  controller?: AbortController; preparing?: boolean
  consumerId: string; settled: boolean; priority: RustStylePriority; bypasses: number
  resolve: (lease: RustPixelPocResultLease) => void; reject: (error: unknown) => void
}

/** One shared service, fair priorities and one latest pending job per consumer. */
export class RustPixelPocStyleScheduler {
  private readonly service: RustPixelPocStyleService
  private readonly limits: Required<RustPixelPocServiceLimits>
  private readonly maxPendingConsumers: number
  private readonly pending = new Map<string, Ticket>()
  private active: Ticket | null = null
  private stopped = false
  private disposal: Promise<void> | null = null
  private running: Promise<void> | null = null
  private readonly lifecycle = new AbortController()
  private sourceKey: { consumerId: string; identity: string } | null = null
  private sourceVersion = 0
  private readonly onChange?: () => void

  constructor(connect: RustPixelPocConnect, limits: RustPixelPocSchedulerLimits = {}, onChange?: () => void) {
    this.onChange = onChange
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
    const workingBytes = this.active?.preparing ? PREPARATION_BYTES + service.sourceBytes :
      service.active ? RUST_STYLE_WORKING_BYTES : service.sourceBytes
    return { ...service, active: Number(!!this.active), pending: this.pending.size,
      preparing: Number(!!this.active?.preparing),
      queuedInputBytes: this.queuedBytes(), reservedBytes: workingBytes + inputBytes + service.retainedResultBytes + this.queuedBytes(), disposed: this.stopped }
  }

  render(consumerId: string, input: RustPixelPocServiceRequest, options: RustPixelPocSchedulingOptions = {}): Promise<RustPixelPocResultLease> {
    return this.submit(consumerId, () => snapshotRustPixelPocStyleRequest(input), options)
  }

  renderPrepared(consumerId: string, preparation: RustPixelPocScheduledPreparation,
    options: RustPixelPocSchedulingOptions = {}): Promise<RustPixelPocResultLease> {
    return this.submit(consumerId, () => {
      if (!preparation || typeof preparation.prepare !== 'function' || !Number.isSafeInteger(preparation.inputBytes) ||
          preparation.inputBytes < 0 || preparation.inputBytes > 4 * 1024 * 1024) throw new RustPixelPocError('invalid-input')
      return { preparation: { ...preparation }, inputBytes: preparation.inputBytes }
    }, options)
  }

  setPriority(consumerId: string, priority: RustStylePriority) {
    if (!rustStylePriorityValid(priority)) throw new RustPixelPocError('invalid-input')
    const ticket = this.pending.get(consumerId)
    if (ticket) ticket.priority = priority
  }

  private submit(consumerId: string, snapshot: () => Pick<Ticket, 'request' | 'preparation' | 'inputBytes'>,
    options: RustPixelPocSchedulingOptions): Promise<RustPixelPocResultLease> {
    if (this.stopped) return Promise.reject(new RustPixelPocError('wasm-unavailable'))
    const priority = options?.priority ?? 'visible'
    if (!rustStylePriorityValid(priority)) return Promise.reject(new RustPixelPocError('invalid-input'))
    if (typeof consumerId !== 'string' || !consumerId || consumerId.length > 512) {
      return Promise.reject(new RustPixelPocError('invalid-input'))
    }
    const previous = this.pending.get(consumerId)
    if (previous) this.reject(previous, new RustPixelPocStyleCancelledError())
    this.cancelActive(consumerId)
    try {
      const prepared = snapshot()
      prepared.inputBytes += consumerId.length * 2
      const queued = this.queuedBytes() - (previous?.inputBytes ?? 0)
      if (!previous && this.pending.size >= this.maxPendingConsumers ||
          this.stats.reservedBytes - (previous?.inputBytes ?? 0) + prepared.inputBytes > this.limits.maxResidentBytes ||
          this.jobWorkingBytes(prepared) + this.service.stats.retainedResultBytes + queued + prepared.inputBytes > this.limits.maxResidentBytes) {
        throw new RustPixelPocError('memory-limit')
      }
      const promise = new Promise<RustPixelPocResultLease>((resolve, reject) => {
        // Replacement preserves queue age, even during repeated edits.
        this.pending.set(consumerId, { ...prepared, consumerId, priority, bypasses: previous?.bypasses ?? 0, settled: false, resolve, reject })
      })
      this.pump()
      this.changed()
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
    this.changed()
  }

  dispose() {
    if (this.disposal) return this.disposal
    this.stopped = true
    this.rejectPending(new RustPixelPocStyleCancelledError())
    if (this.active) this.reject(this.active, new RustPixelPocStyleCancelledError())
    this.active?.controller?.abort(); this.lifecycle.abort()
    this.sourceKey = null
    this.disposal = Promise.all([this.service.dispose(), this.running]).then(() => { this.changed() })
    this.changed()
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
    this.active.controller?.abort()
    this.service.cancel()
  }

  private jobWorkingBytes(ticket: Pick<Ticket, 'preparation'>) {
    return ticket.preparation ? PREPARATION_BYTES + this.service.stats.sourceBytes : RUST_STYLE_WORKING_BYTES
  }

  private pump() {
    if (this.active || this.stopped) return
    while (this.pending.size) {
      const ticket = this.nextTicket()
      if (this.jobWorkingBytes(ticket) + this.queuedBytes() + this.service.stats.retainedResultBytes > this.limits.maxResidentBytes) {
        this.pending.delete(ticket.consumerId)
        this.reject(ticket, new RustPixelPocError('memory-limit'))
        continue
      }
      for (const waiting of this.pending.values()) {
        if (waiting === ticket) break
        waiting.bypasses = Math.min(MAX_PRIORITY_BYPASSES, waiting.bypasses + 1)
      }
      this.pending.delete(ticket.consumerId)
      this.active = ticket
      this.running = this.run(ticket)
      return
    }
  }

  private nextTicket() {
    const rank = { background: 0, visible: 1, active: 2 }
    let next: Ticket | undefined
    for (const ticket of this.pending.values()) {
      if (ticket.bypasses >= MAX_PRIORITY_BYPASSES) return ticket
      if (!next || rank[ticket.priority] > rank[next.priority]) next = ticket
    }
    return next!
  }

  private async run(ticket: Ticket) {
    try {
      if (ticket.preparation) {
        ticket.preparing = true
        this.changed()
        const controller = ticket.controller = new AbortController()
        let timeout: ReturnType<typeof setTimeout> | undefined
        let onDispose = () => {}
        const disposed = new Promise<never>((_, reject) => {
          onDispose = () => reject(new RustPixelPocStyleCancelledError())
          this.lifecycle.signal.addEventListener('abort', onDispose, { once: true })
        })
        const deadline = new Promise<never>((_, reject) => {
          timeout = setTimeout(() => {
            reject(new RustPixelPocError('wasm-unavailable'))
            controller.abort(); this.stopped = true
            this.rejectPending(new RustPixelPocError('wasm-unavailable'))
            void this.service.dispose().catch(() => {})
          }, this.limits.taskTimeoutMs)
        })
        try {
          if (ticket.settled || this.stopped) throw new RustPixelPocStyleCancelledError()
          const input = await Promise.race([ticket.preparation.prepare(controller.signal), deadline, disposed])
          if (ticket.settled || this.stopped || controller.signal.aborted) throw new RustPixelPocStyleCancelledError()
          const prepared = snapshotRustPixelPocStyleRequest(input)
          if (prepared.inputBytes > ticket.inputBytes + PREPARATION_BYTES) throw new RustPixelPocError('memory-limit')
          ticket.request = prepared.request; ticket.inputBytes = prepared.inputBytes + ticket.consumerId.length * 2
        } finally {
          clearTimeout(timeout); this.lifecycle.signal.removeEventListener('abort', onDispose)
          ticket.preparing = false; ticket.preparation = undefined
        }
        if (RUST_STYLE_WORKING_BYTES + ticket.inputBytes + this.queuedBytes() + this.service.stats.retainedResultBytes > this.limits.maxResidentBytes) {
          throw new RustPixelPocError('memory-limit')
        }
      }
      if (ticket.settled || this.stopped) throw new RustPixelPocStyleCancelledError()
      const request = ticket.request!
      const identity = request.sourceIdentity
      if (this.sourceKey?.consumerId !== ticket.consumerId || this.sourceKey.identity !== identity) {
        this.sourceKey = { consumerId: ticket.consumerId, identity }; this.sourceVersion++
      }
      const lease = await this.service.render({ ...request, sourceIdentity: `scheduler-source:${this.sourceVersion}` })
      if (ticket.settled || this.stopped) { lease.release(); return }
      if (this.stats.reservedBytes > this.limits.maxResidentBytes) {
        lease.release(); throw new RustPixelPocError('memory-limit')
      }
      ticket.settled = true
      ticket.resolve({ result: lease.result, release: () => { lease.release(); this.changed() } })
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
      this.changed()
    }
  }

  private changed() {
    // Diagnostics must not fail rendering or leak a lease.
    try { this.onChange?.() } catch {}
  }
}
