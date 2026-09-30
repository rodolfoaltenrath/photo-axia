import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'

const side = Number(process.argv[2] ?? 512)
const samples = Number(process.argv[3] ?? 10)
if (!Number.isInteger(side) || side < 16 || side > 2048 ||
    !Number.isInteger(samples) || samples < 3 || samples > 30) {
  throw new Error('Uso: node benchmarks/rustPixelWorkerBaseline.mjs [lado 16..2048] [amostras 3..30]')
}

const wasmPath = new URL('../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url)
const wasm = readFileSync(wasmPath)
const wasmBuffer = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)
const worker = new Worker(new URL('../scripts/rustPixelPoc.node-worker.mjs', import.meta.url))
const pending = new Map()
let nextId = 0
worker.on('message', (message) => {
  const waiter = pending.get(message.id)
  if (!waiter) return
  pending.delete(message.id)
  clearTimeout(waiter.timeout)
  if (message.type === 'error') waiter.reject(new Error(message.code))
  else waiter.resolve(message)
})
worker.on('error', (error) => {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timeout)
    waiter.reject(error)
  }
  pending.clear()
})
function send(request, transfer = []) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Worker timeout: ${id}`))
    }, 30_000)
    pending.set(id, { resolve, reject, timeout })
    worker.postMessage({ ...request, id }, transfer)
  })
}

const template = new Uint8Array(side * side * 4)
for (let index = 0; index < template.length; index += 4) {
  template[index] = (index / 4 * 17) % 256
  template[index + 1] = 80
  template[index + 2] = 120
  template[index + 3] = (index / 4 * 31) % 256
}
const series = []
let initMs = 0
function median(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
function p95(numbers) {
  const sorted = [...numbers].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]
}
function rounded(number) { return Number(number.toFixed(3)) }

try {
  const initStarted = performance.now()
  assert.equal((await send({ type: 'init', wasm: wasmBuffer }, [wasmBuffer])).type, 'ready')
  initMs = performance.now() - initStarted
  for (let iteration = -3; iteration < samples; iteration++) {
    const started = performance.now()
    const source = template.slice()
    const cloned = performance.now()
    const result = await send({ type: 'render', rgba: source.buffer, fillOpacity: 50 }, [source.buffer])
    const finished = performance.now()
    assert.equal(result.type, 'rendered')
    assert.equal(result.rgba.byteLength, template.byteLength)
    if (iteration >= 0) series.push({ callerCopyMs: cloned - started, totalMs: finished - started, ...result.timings })
  }
  await send({ type: 'dispose' })
} finally {
  await worker.terminate()
}

const fields = ['callerCopyMs', 'allocationMs', 'copyInMs', 'kernelMs', 'copyOutMs', 'releaseMs', 'totalMs']
const measurements = Object.fromEntries(fields.map((field) => [field, {
  median: rounded(median(series.map((sample) => sample[field]))),
  p95Sample: rounded(p95(series.map((sample) => sample[field])))
}]))
process.stdout.write(`${JSON.stringify({
  benchmark: 'rust-poc-fill-opacity-worker',
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  cpu: os.cpus()[0]?.model,
  pixels: side * side,
  bytes: template.byteLength,
  wasmBytes: wasm.byteLength,
  samples,
  warmups: 3,
  initMs: rounded(initMs),
  measurements
})}\n`)
