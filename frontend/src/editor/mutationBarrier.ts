export class MutationBarrier {
  private pending?: Promise<boolean>

  get isPending() {
    return Boolean(this.pending)
  }

  track(operation: Promise<boolean>) {
    this.pending = operation
    void operation.finally(() => {
      if (this.pending === operation) this.pending = undefined
    }).catch(() => undefined)
    return operation
  }

  discard() {
    const hadPendingOperation = Boolean(this.pending)
    this.pending = undefined
    return hadPendingOperation
  }

  async wait() {
    const operation = this.pending
    if (!operation) return true
    try {
      return await operation
    } catch {
      return false
    }
  }
}
