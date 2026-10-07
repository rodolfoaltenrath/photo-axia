import { RustPixelPocError } from './rustPixelPocError.ts'
import { readRustStylePreviewBlob } from './rustStylePreviewMedia.ts'

const MiB = 1024 * 1024
type Entry = { version: string; url: string; blob: Blob; bytes: number }
export type RustStyleMediaReader = typeof readRustStylePreviewBlob

/** Encoded media only; eviction never revokes URLs or mutates borrowed Blobs. */
export class RustStylePreviewMediaCache {
  readonly maxBytes: number
  private readonly maxEntries: number
  private readonly entries = new Map<string, Entry>()
  private bytes = 0
  private epoch = 0
  private filling: { key: string; token: symbol } | undefined
  private counts = { hits: 0, misses: 0, loads: 0, evictions: 0 }

  constructor(maxBytes = 32 * MiB, maxEntries = 64) {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > 32 * MiB ||
      !Number.isSafeInteger(maxEntries) || maxEntries < 1 || maxEntries > 64) throw new RustPixelPocError('invalid-input')
    this.maxBytes = maxBytes; this.maxEntries = maxEntries
  }

  get stats() { return { ...this.counts, entries: this.entries.size, bytes: this.bytes, maxBytes: this.maxBytes } }

  async read(key: string, version: string, url: string, signal: AbortSignal, limit = 64 * MiB,
    reader: RustStyleMediaReader = readRustStylePreviewBlob): Promise<Blob> {
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 64 * MiB) throw new RustPixelPocError('memory-limit')
    if (typeof key !== 'string' || !key || typeof version !== 'string' || !version || typeof url !== 'string' || !url) {
      throw new RustPixelPocError('invalid-input')
    }
    signal.throwIfAborted()
    const cached = this.entries.get(key)
    if (cached && cached.version === version && cached.url === url) {
      if (cached.blob.size > limit) throw new RustPixelPocError('memory-limit')
      this.counts.hits++
      this.entries.delete(key); this.entries.set(key, cached)
      return cached.blob
    }
    this.remove(key)
    this.counts.misses++; this.counts.loads++
    const epoch = this.epoch, token = Symbol(), metadataBytes = (key.length + version.length + url.length) * 2
    const cacheable = metadataBytes < this.maxBytes && /^(blob:|data:)/.test(url)
    // Preparation is serial; only the latest fill may publish into the cache.
    if (cacheable) this.filling = { key, token }
    try {
      const blob = await reader(url, signal, limit)
      signal.throwIfAborted()
      if (!(blob instanceof Blob) || !blob.size) throw new RustPixelPocError('invalid-input')
      if (blob.size > limit) throw new RustPixelPocError('memory-limit')
      const bytes = blob.size + metadataBytes
      if (epoch !== this.epoch || bytes > this.maxBytes || !cacheable || this.filling?.token !== token) return blob
      this.remove(key)
      while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
        this.remove(this.entries.keys().next().value!)
        this.counts.evictions++
      }
      this.entries.set(key, { version, url, blob, bytes }); this.bytes += bytes
      return blob
    } finally {
      if (this.filling?.token === token) this.filling = undefined
    }
  }

  releaseConsumer(consumerId: string) {
    const key = `source:${consumerId}`
    this.remove(key)
    if (this.filling?.key === key) this.filling = undefined
  }

  clear() { this.epoch++; this.filling = undefined; this.entries.clear(); this.bytes = 0 }

  private remove(key: string) {
    const entry = this.entries.get(key)
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(key) }
  }
}
