import { RustPixelPocError } from './rustPixelPocError.ts'

export async function readRustStylePreviewBlob(url: string, signal: AbortSignal, limit = 64 * 1024 * 1024,
  fetchBlob: typeof fetch = fetch) {
  if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 64 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
  signal.throwIfAborted()
  const response = await fetchBlob(url, { signal })
  if (!response.ok) { await response.body?.cancel(); throw new RustPixelPocError('invalid-input') }
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel(); throw new RustPixelPocError('memory-limit')
  }
  if (!response.body) throw new RustPixelPocError('invalid-input')
  const reader = response.body.getReader(), chunks: Uint8Array<ArrayBuffer>[] = []
  let bytes = 0
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  if (signal.aborted) abort()
  try {
    while (true) {
      signal.throwIfAborted()
      const { done, value } = await reader.read()
      signal.throwIfAborted()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) { await reader.cancel(); throw new RustPixelPocError('memory-limit') }
      chunks.push(new Uint8Array(value))
    }
    if (!bytes) throw new RustPixelPocError('invalid-input')
    return new Blob(chunks, { type: response.headers.get('content-type') ?? '' })
  } finally {
    signal.removeEventListener('abort', abort)
    reader.releaseLock()
  }
}
