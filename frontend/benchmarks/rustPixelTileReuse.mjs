import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { Worker } from 'node:worker_threads'

const side = Number(process.argv[2] ?? 1024)
const tileSide = Number(process.argv[3] ?? 256)
const samples = Number(process.argv[4] ?? 10)
if (!Number.isInteger(side) || side < 16 || side > 2048 ||
    !Number.isInteger(tileSide) || tileSide < 1 || tileSide > side ||
    !Number.isInteger(samples) || samples < 3 || samples > 30) {
  throw new Error('Uso: benchmark:rust-tiles -- [lado 16..2048] [tile 1..lado] [amostras 3..30]')
}

const wasmPath = new URL('../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url)
const wasm = readFileSync(wasmPath)
const wasmBuffer = wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength)
const worker = new Worker(new URL('../scripts/rustPixelPoc.node-worker.mjs', import.meta.url))
const pending = new Map()
let nextId = 0
worker.on('message', (message) => {
  const entry = pending.get(message.id)
  if (!entry) return
  pending.delete(message.id)
  clearTimeout(entry.timeout)
  if (message.type === 'error') entry.reject(new Error(message.code))
  else entry.resolve(message)
})
worker.on('error', (error) => {
  for (const entry of pending.values()) {
    clearTimeout(entry.timeout)
    entry.reject(error)
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
function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}
function p95(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.ceil(sorted.length * 0.95) - 1]
}
function summary(values) {
  return { median: Number(median(values).toFixed(3)), p95Sample: Number(p95(values).toFixed(3)) }
}

const template = new Uint8Array(side * side * 4)
for (let index = 0; index < template.length; index += 4) {
  template[index] = (index / 4 * 17) % 256
  template[index + 1] = 80
  template[index + 2] = 120
  template[index + 3] = (index / 4 * 31) % 256
}
const region = { x: side - tileSide, y: side - tileSide, width: tileSide, height: tileSide }
const copied = []
const reused = []
let stageTotalMs = 0
let stagingMs = 0
try {
  assert.equal((await send({ type: 'init', wasm: wasmBuffer }, [wasmBuffer])).type, 'ready')
  const stageStarted = performance.now()
  const stagedInput = template.slice()
  const staged = await send({ type: 'stage-source', rgba: stagedInput.buffer,
    sourceWidth: side, sourceHeight: side, generation: 1 }, [stagedInput.buffer])
  stageTotalMs = performance.now() - stageStarted
  assert.equal(staged.type, 'source-staged')
  stagingMs = staged.stagingMs
  for (let iteration = -3; iteration < samples; iteration++) {
    const copiedStarted = performance.now()
    const source = template.slice()
    const fullInput = await send({ type: 'render-region', rgba: source.buffer,
      sourceWidth: side, sourceHeight: side, region, fillOpacity: 50 }, [source.buffer])
    const copiedTotalMs = performance.now() - copiedStarted
    assert.equal(fullInput.type, 'rendered-region')

    const reusedStarted = performance.now()
    const cachedInput = await send({ type: 'render-staged-region', sourceId: staged.sourceId,
      region, fillOpacity: 50 })
    const reusedTotalMs = performance.now() - reusedStarted
    assert.equal(cachedInput.type, 'rendered-staged-region')
    assert.deepEqual(new Uint8Array(cachedInput.rgba), new Uint8Array(fullInput.rgba))
    if (iteration >= 0) {
      copied.push({ totalMs: copiedTotalMs, ...fullInput.timings })
      reused.push({ totalMs: reusedTotalMs, ...cachedInput.timings })
    }
  }
  assert.equal((await send({ type: 'release-source', sourceId: staged.sourceId })).type, 'source-released')
  assert.equal((await send({ type: 'dispose' })).type, 'disposed')
} finally {
  await worker.terminate()
}

const fields = ['totalMs', 'allocationMs', 'copyInMs', 'kernelMs', 'copyOutMs', 'releaseMs']
const summarize = (series) => Object.fromEntries(fields.map((field) =>
  [field, summary(series.map((sample) => sample[field]))]))
process.stdout.write(`${JSON.stringify({
  benchmark: 'rust-poc-region-source-reuse-worker',
  platform: process.platform,
  arch: process.arch,
  node: process.version,
  cpu: os.cpus()[0]?.model,
  sourcePixels: side * side,
  sourceBytes: template.byteLength,
  tilePixels: tileSide * tileSide,
  samples,
  warmups: 3,
  stageTotalMs: Number(stageTotalMs.toFixed(3)),
  wasmStagingMs: Number(stagingMs.toFixed(3)),
  repeatedFullSource: summarize(copied),
  reusedSource: summarize(reused)
})}\n`)
