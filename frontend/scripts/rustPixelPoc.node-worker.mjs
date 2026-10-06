// Minimal browser-Worker bridge for testing the actual worker module in Node.
import { parentPort, workerData } from 'node:worker_threads'

if (!parentPort) throw new Error('Worker parent ausente')
let releaseEncoding = null
if (workerData?.mediaFixtures) {
  const { installRustMediaFixtures } = await import('./tests/support/rustMediaFixture.ts')
  const fixture = installRustMediaFixtures({ encodeDelayMs: workerData.encodeDelayMs, failEncodeCount: workerData.failEncodeCount })
  fixture.state.onEncode = () => parentPort.postMessage({ type: 'fixture-encode-started' })
  if (workerData.holdEncoding) {
    fixture.state.encodeBlock = new Promise(resolve => {
      releaseEncoding = () => { fixture.state.encodeBlock = null; resolve() }
    })
  }
}
const queued = []
globalThis.self = {
  onmessage: null,
  postMessage(message, options = {}) {
    parentPort.postMessage(message, options.transfer ?? [])
  }
}
parentPort.on('message', (data) => {
  if (data.type === 'fixture-release-encoding') { releaseEncoding?.(); releaseEncoding = null; return }
  if (globalThis.self.onmessage) globalThis.self.onmessage({ data })
  else queued.push(data)
})
await import('../src/workers/rustPixelPoc.worker.ts')
for (const data of queued) globalThis.self.onmessage?.({ data })
