export interface ByteSizedCacheValue {
  byteSize: number
  dispose?: () => void
}

export class ByteBudgetLruCache<T extends ByteSizedCacheValue> {
  private readonly entries = new Map<string, T>()
  private usedBytes = 0
  readonly maxBytes: number
  readonly maxEntries: number

  constructor(maxBytes: number, maxEntries: number) {
    if (!Number.isFinite(maxBytes) || maxBytes < 0 || !Number.isInteger(maxEntries) || maxEntries < 0) {
      throw new Error('Limites de cache inválidos.')
    }
    this.maxBytes = maxBytes
    this.maxEntries = maxEntries
  }

  get sizeBytes() {
    return this.usedBytes
  }

  get size() {
    return this.entries.size
  }

  get(key: string) {
    const value = this.entries.get(key)
    if (!value) return undefined
    this.entries.delete(key)
    this.entries.set(key, value)
    return value
  }

  set(key: string, value: T) {
    const byteSize = Number.isFinite(value.byteSize) ? Math.max(0, value.byteSize) : 0
    if (byteSize > this.maxBytes || this.maxEntries === 0) return false
    this.delete(key)
    this.entries.set(key, value)
    this.usedBytes += byteSize
    this.trim()
    return true
  }

  delete(key: string) {
    const value = this.entries.get(key)
    if (!value) return false
    this.entries.delete(key)
    this.usedBytes -= Number.isFinite(value.byteSize) ? Math.max(0, value.byteSize) : 0
    value.dispose?.()
    return true
  }

  clear() {
    for (const value of this.entries.values()) value.dispose?.()
    this.entries.clear()
    this.usedBytes = 0
  }

  private trim() {
    while (this.entries.size > this.maxEntries || this.usedBytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.delete(oldest)
    }
  }
}

export class LatestGenerationByKey {
  private readonly generations = new Map<string, number>()

  begin(key: string) {
    const generation = (this.generations.get(key) ?? 0) + 1
    this.generations.set(key, generation)
    return {
      generation,
      isCurrent: () => this.generations.get(key) === generation
    }
  }

  invalidate(key: string) {
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1)
  }

  delete(key: string) {
    this.generations.delete(key)
  }

  clear() {
    this.generations.clear()
  }
}
