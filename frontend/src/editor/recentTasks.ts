export class LatestRequestGate {
  private generation = 0

  begin() {
    const generation = ++this.generation
    return {
      isCurrent: () => generation === this.generation
    }
  }

  invalidate() {
    this.generation++
  }
}

export class LatestPathTaskQueue {
  private readonly generations = new Map<string, number>()
  private readonly queues = new Map<string, Promise<void>>()

  enqueue(path: string, task: (isLatest: () => boolean) => Promise<void>) {
    const key = path.toLowerCase()
    const generation = (this.generations.get(key) ?? 0) + 1
    this.generations.set(key, generation)
    const isLatest = () => this.generations.get(key) === generation
    const previous = this.queues.get(key) ?? Promise.resolve()
    const queued = previous.catch(() => undefined).then(() => task(isLatest))
    this.queues.set(key, queued)
    const cleanup = () => {
      if (this.queues.get(key) === queued) {
        this.queues.delete(key)
        if (isLatest()) this.generations.delete(key)
      }
    }
    void queued.then(cleanup, cleanup)
    return queued
  }
}
