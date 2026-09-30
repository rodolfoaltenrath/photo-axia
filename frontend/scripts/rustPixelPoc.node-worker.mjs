// Minimal browser-Worker bridge for testing the actual worker module in Node.
import { parentPort } from 'node:worker_threads'

if (!parentPort) throw new Error('Worker parent ausente')
const queued = []
globalThis.self = {
  onmessage: null,
  postMessage(message, options = {}) {
    parentPort.postMessage(message, options.transfer ?? [])
  }
}
parentPort.on('message', (data) => {
  if (globalThis.self.onmessage) globalThis.self.onmessage({ data })
  else queued.push(data)
})
await import('../src/workers/rustPixelPoc.worker.ts')
for (const data of queued) globalThis.self.onmessage?.({ data })
