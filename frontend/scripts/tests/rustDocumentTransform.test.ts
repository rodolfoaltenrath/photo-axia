import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeDocumentComposite, documentCompositePacketLayout, type RustDocumentCompositeJob,
  type RustDocumentRasterLayer } from '../../src/editor/rustDocumentComposite.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
type Matrix = NonNullable<RustDocumentRasterLayer['sourceToDocument']>
function layer(matrix: Matrix = [1, 0, 0, 1, 0, 0], rgba = new Uint8Array([30, 60, 90, 255])): RustDocumentRasterLayer {
  return { rgba, width: rgba.length / 4, height: 1, x: 0, y: 0, visible: true, opacity: 100, blendMode: 'normal', sourceToDocument: matrix }
}
function job(layers = [layer()], width = 2, height = 1): RustDocumentCompositeJob {
  return { documentWidth: width, documentHeight: height, region: { x: 0, y: 0, width, height },
    resolutionScale: 1, layersBottomToTop: layers, outputGrid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 } }
}
function invalid(operation: () => unknown, code: RustPixelPocError['code'] = 'invalid-input') {
  assert.throws(operation, error => error instanceof RustPixelPocError && error.code === code)
}

test('DCP2 versiona matriz/grade e preserva campos reservados e ownership', () => {
  const request = job([layer([1, 0, 0, 1, 0.25, 0])]), packet = encodeDocumentComposite(request), view = new DataView(packet.buffer)
  assert.equal(packet.length, 164); assert.equal(view.getUint32(0, true), 0x32504344)
  assert.equal(view.getUint32(4, true), 2); assert.equal(view.getUint32(8, true), 80)
  assert.equal(view.getUint32(80, true), 160); assert.equal(view.getFloat64(144, true), 0.25)
  assert.equal(view.getFloat64(40, true), 1); assert.equal(view.getFloat64(48, true), 1)
  assert.deepEqual([...packet.slice(72, 80)], [0, 0, 0, 0, 0, 0, 0, 0])
  assert.deepEqual(documentCompositePacketLayout(packet), { region: request.region, packetBytes: 164, outputBytes: 8, workingBytes: 300 })
  request.layersBottomToTop[0]!.rgba.fill(0)
  assert.deepEqual([...packet.slice(160)], [30, 60, 90, 255])
})

test('preflight rejeita matriz singular/não finita, grade inválida e origens ambíguas', () => {
  for (const matrix of [[0, 0, 0, 0, 0, 0], [1, 2, 2, 4, 0, 0], [1e-8, 0, 0, 1e-8, 0, 0], [1, 0, 0, 1, NaN, 0], [1e7, 0, 0, 1, 0, 0]] as Matrix[]) invalid(() => encodeDocumentComposite(job([layer(matrix)])))
  const sparse = [1, 0, 0, 1, 0, 0]; delete sparse[4]
  invalid(() => encodeDocumentComposite(job([layer(sparse as unknown as Matrix)])))
  invalid(() => encodeDocumentComposite(job([{ ...layer(), x: 1 }])))
  invalid(() => encodeDocumentComposite({ ...job(), outputGrid: undefined }))
  for (const value of [0, -1, NaN, Infinity, 129, 1 / 2048]) invalid(() => encodeDocumentComposite({ ...job(), outputGrid: { scaleX: value, scaleY: 1, originX: 0, originY: 0 } }))
  invalid(() => encodeDocumentComposite({ ...job(), outputGrid: { scaleX: 1, scaleY: 1, originX: Infinity, originY: 0 } }))
  const packet = encodeDocumentComposite(job()); packet[72] = 1
  invalid(() => documentCompositePacketLayout(packet))
})

test('WASM reproduz goldens de cobertura, alfa premultiplicado, rotação, reflexão e escala', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const cases: [RustDocumentCompositeJob, number[]][] = [
      [job([layer([1, 0, 0, 1, 0.25, 0])]), [30, 60, 90, 191, 30, 60, 90, 64]],
      [job([layer([2, 0, 0, 2, 0, 0])], 2, 2), [30, 60, 90, 255, 30, 60, 90, 255, 30, 60, 90, 255, 30, 60, 90, 255]],
      [job([layer([2, 0, 0, 1, 0, 0], new Uint8Array([255, 0, 0, 255, 0, 0, 255, 0]))], 4), [255, 0, 0, 255, 255, 0, 0, 191, 255, 0, 0, 64, 0, 0, 0, 0]],
      [job([layer([0, 1, -1, 0, 1, 0], new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]))], 1, 2), [255, 0, 0, 255, 0, 0, 255, 255]],
      [job([layer([-1, 0, 0, 1, 2, 0], new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]))]), [0, 0, 255, 255, 255, 0, 0, 255]],
      [{ ...job([layer([1, 0, 0, 1, 0, 0], new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]))]), region: { x: 0, y: 0, width: 1, height: 1 }, outputGrid: { scaleX: 0.5, scaleY: 1, originX: 0, originY: 0 } }, [128, 0, 128, 255]],
      [{ ...job([layer()], 1), region: { x: 0, y: 0, width: 2, height: 1 }, outputGrid: { scaleX: 1.5, scaleY: 1, originX: 0, originY: 0 } }, [30, 60, 90, 255, 30, 60, 90, 128]],
      [{ ...job([layer()], 1), outputGrid: { scaleX: 1, scaleY: 1, originX: 0.25, originY: 0 } }, [30, 60, 90, 191]]
    ]
    for (const [request, expected] of cases) assert.deepEqual([...runtime.composeDocumentRegion(request).rgba], expected)
  } finally { runtime.dispose() }
})

test('WASM: rotação/shear/zoom fracionário/DPR usam grade global sem emendas em todos os modos', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const pixels = Uint8Array.from({ length: 5 * 4 * 4 }, (_, i) => (i * 19) % 256)
  try {
    for (const matrix of [[0.8, 0.6, -0.6, 0.8, 3.25, -0.125], [1, 0.25, 0.125, 1, -0.25, 2.125], [-1, 0, 0, 1, 7.125, 1.375]] as Matrix[]) {
      for (const blendMode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const) {
        const lower = { ...layer([1, 0, 0, 1, 0, 0], pixels), width: 5, height: 4 }
        const upper = { ...layer(matrix, pixels), width: 5, height: 4, opacity: 63.7, blendMode }
        const request = { ...job([lower, upper], 10, 9), region: { x: 0, y: 0, width: 14, height: 8 }, outputGrid: { scaleX: 1.375, scaleY: 0.875, originX: -0.125, originY: 0.25 } }
        const full = runtime.composeDocumentRegion(request)
        for (const tileSize of [1, 2, 3, 7]) {
          const stitched = new Uint8Array(full.rgba.length)
          for (let y = 0; y < 8; y += tileSize) for (let x = 0; x < 14; x += tileSize) {
            const region = { x, y, width: Math.min(tileSize, 14 - x), height: Math.min(tileSize, 8 - y) }
            const tile = runtime.composeDocumentRegion({ ...request, region })
            for (let row = 0; row < region.height; row++) stitched.set(tile.rgba.subarray(row * region.width * 4, (row + 1) * region.width * 4), ((y + row) * 14 + x) * 4)
          }
          assert.deepEqual(stitched, full.rgba)
        }
      }
    }
  } finally { runtime.dispose() }
})

test('limite de trabalho é independente da memória e ABI preserva saída em rejeição', async () => {
  const source = layer([1024, 0, 0, 1024, 0, 0])
  const request = job(Array(17).fill(source), 1024, 1024)
  invalid(() => encodeDocumentComposite(request), 'work-limit')
  const packet = encodeDocumentComposite({ ...request, region: { x: 0, y: 0, width: 1, height: 1 } })
  const view = new DataView(packet.buffer); view.setUint32(32, 1024, true); view.setUint32(36, 1024, true)
  invalid(() => documentCompositePacketLayout(packet), 'work-limit')
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const memory = instance.exports.memory as WebAssembly.Memory
  const alloc = instance.exports.axia_poc_alloc as (n: number) => number, free = instance.exports.axia_poc_free as (p: number, n: number) => void
  const apply = instance.exports.axia_poc_document_region as (p: number, n: number, o: number, l: number) => number
  const length = 1024 * 1024 * 4, p = alloc(packet.length), o = alloc(length)
  try {
    new Uint8Array(memory.buffer, p, packet.length).set(packet); new Uint8Array(memory.buffer, o, length).fill(99)
    assert.equal(apply(p, packet.length, o, length), 7)
    assert.ok(new Uint8Array(memory.buffer, o, length).every(value => value === 99))
  } finally { free(o, length); free(p, packet.length) }
})

test('Worker executa DCP2 e retorna erro recuperável para matriz inválida', async () => {
  const harness = createRustPixelWorkerHarness()
  try {
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    const packet = encodeDocumentComposite(job([layer([1, 0, 0, 1, 0.25, 0])]))
    const result = await harness.send({ type: 'compose-document-region', packet: packet.buffer }, [packet.buffer])
    assert.equal(packet.length, 0); assert.equal(result.type, 'rendered-document-region')
    if (result.type !== 'rendered-document-region') assert.fail('resposta documental esperada')
    assert.deepEqual([...new Uint8Array(result.rgba)], [30, 60, 90, 191, 30, 60, 90, 64])
    const broken = encodeDocumentComposite(job()); new DataView(broken.buffer).setFloat64(112, 0, true)
    const error = await harness.send({ type: 'compose-document-region', packet: broken.buffer }, [broken.buffer])
    assert.equal(error.type, 'error'); if (error.type === 'error') assert.equal(error.code, 'invalid-input')
    const latest = encodeDocumentComposite(job())
    assert.equal((await harness.send({ type: 'compose-document-region', packet: latest.buffer }, [latest.buffer])).type, 'rendered-document-region')
    await harness.send({ type: 'dispose' })
  } finally { await harness.close() }
})

test('capability ausente permite DCP1 mas recusa DCP2 sem chamar kernel antigo', async () => {
  const instantiate = WebAssembly.instantiate, base = await instantiate(wasm, {})
  const { axia_poc_document_packet_version: _version, ...legacy } = base.instance.exports
  let runtime: Awaited<ReturnType<typeof createRustPixelPocRuntime>>
  try {
    WebAssembly.instantiate = (async () => ({ module: base.module, instance: { exports: legacy } })) as unknown as typeof WebAssembly.instantiate
    runtime = await createRustPixelPocRuntime(wasm)
  } finally { WebAssembly.instantiate = instantiate }
  try {
    invalid(() => runtime.composeDocumentRegion(job()), 'wasm-unavailable')
    const { sourceToDocument: _matrix, ...source } = layer()
    assert.deepEqual([...runtime.composeDocumentRegion({ ...job([source], 1), outputGrid: undefined }).rgba], [30, 60, 90, 255])
  } finally { runtime.dispose() }
})
