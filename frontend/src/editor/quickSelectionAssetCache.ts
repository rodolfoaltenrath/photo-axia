import type { ImageAsset } from '../types/editor'

export function quickSelectionAssetKey(asset: ImageAsset) {
  return JSON.stringify([
    asset.sourceUrl,
    asset.editToken ?? '',
    asset.width,
    asset.height,
    asset.mimeType,
    asset.byteSize ?? -1
  ])
}

function waitForBlob(promise: Promise<Blob>, signal?: AbortSignal) {
  if (!signal) return promise
  signal.throwIfAborted()
  return new Promise<Blob>((resolve, reject) => {
    const abort = () => reject(new DOMException('Seleção cancelada.', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    void promise.then(
      (blob) => {
        signal.removeEventListener('abort', abort)
        resolve(blob)
      },
      (error) => {
        signal.removeEventListener('abort', abort)
        reject(error)
      }
    )
  })
}

interface BlobCacheEntry {
  key: string
  blob?: Blob
  pending?: Promise<Blob>
}

/** Mantém apenas o raster fonte mais recente, sem acoplar o cache ao estado Vue. */
export class QuickSelectionAssetCache {
  private entry: BlobCacheEntry | undefined

  get(key: string, load: () => Promise<Blob>, signal?: AbortSignal) {
    const current = this.entry
    if (current?.key === key) {
      if (current.blob) return waitForBlob(Promise.resolve(current.blob), signal)
      if (current.pending) return waitForBlob(current.pending, signal)
    }

    const entry: BlobCacheEntry = { key }
    const pending = load().then(
      (blob) => {
        if (this.entry === entry) {
          entry.blob = blob
          entry.pending = undefined
        }
        return blob
      },
      (error) => {
        if (this.entry === entry) this.entry = undefined
        throw error
      }
    )
    entry.pending = pending
    this.entry = entry
    return waitForBlob(pending, signal)
  }

  clear() {
    this.entry = undefined
  }
}
