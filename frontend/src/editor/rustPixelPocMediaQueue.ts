import { RustPixelPocError } from './rustPixelPocError.ts'

/** Decodes are serial; lifecycle barriers bypass this queue. */
export class RustPixelPocMediaQueue {
  private tail: Promise<void> = Promise.resolve()
  private size = 0

  run<T>(work: () => Promise<T>): Promise<T> {
    if (this.size >= 8) return Promise.reject(new RustPixelPocError('memory-limit'))
    this.size++
    const result = this.tail.then(work)
    this.tail = result.then(() => {}, () => {}).finally(() => { this.size-- })
    return result
  }
}
