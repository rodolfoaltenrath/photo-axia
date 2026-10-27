import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { createRustPixelPocRuntime } from '../../src/editor/rustPixelPocRuntime.ts'
import { prepareRustDocumentMedia } from '../../src/editor/rustDocumentMedia.ts'
import { RustDocumentOffscreen, loadRustDocumentMedia } from '../../src/editor/rustDocumentOffscreen.ts'
import { RustPixelPocWorkerClient } from '../../src/editor/rustPixelPocWorkerClient.ts'
import { planRustDocumentText, type RustDocumentTextPixels, type RustDocumentTextSource } from '../../src/editor/rustDocumentText.ts'
import { DEFAULT_TEXT_LAYER } from '../../src/editor/text.ts'
import type { RustDocumentMediaInput, RustEditorialPlan } from '../../src/editor/rustDocumentEditorial.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { installRustMediaFixtures } from './support/rustMediaFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const light = { angle: 120, altitude: 30 }
// Vermelho semitransparente e azul opaco: ida e volta premultiplicada exata no compositor.
const glyphs = () => new Uint8Array([255, 0, 0, 128, 0, 0, 255, 255]).buffer

function pixels(overrides: Partial<RustDocumentTextPixels> = {}): RustDocumentTextPixels {
  return { type: 'text-pixels', width: 2, height: 1, originX: 1, originY: 1, rgba: glyphs(), ...overrides }
}

function textInput(source = pixels()): RustDocumentMediaInput {
  return { documentWidth: 3, documentHeight: 2, width: 3, height: 2,
    grid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layers: [{
      source, patterns: {},
      input: { sourceIdentity: 'text:caption', sourceWidth: source.width, sourceHeight: source.height,
        styles: normalizeLayerStyleConfig({}), globalLight: light, quality: 'final' },
      matrix: [1, 0, 0, 1, source.originX, source.originY], opacity: 100, blendMode: 'normal' }] }
}

const expectedDocument = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 128, 0, 0, 255, 255]

test('pixels de texto compõem 1:1 no WASM sem decoder, Canvas nem STG1', async () => {
  const fixtures = installRustMediaFixtures(), runtime = await createRustPixelPocRuntime(wasm)
  try {
    const packet = await prepareRustDocumentMedia(textInput(), () => {})
    const document = runtime.prepareDocumentPacket(packet, 1)
    assert.deepEqual([...runtime.composePreparedDocument(document.documentId, { x: 0, y: 0, width: 3, height: 2 }).rgba],
      expectedDocument)
    assert.equal(fixtures.state.decodes, 0); assert.equal(fixtures.state.canvases.length, 0)
  } finally { fixtures.restore(); runtime.dispose() }
})

test('Worker rejeita texto adulterado: opacidade/Fill duplicados, matriz e buffer inconsistentes', async () => {
  for (const mutate of [
    (request: RustDocumentMediaInput) => { request.layers[0]!.opacity = 50 },
    (request: RustDocumentMediaInput) => { request.layers[0]!.input.styles.fillOpacity = 50 },
    (request: RustDocumentMediaInput) => { request.layers[0]!.matrix = [1, 0, 0, 1, 0, 1] },
    (request: RustDocumentMediaInput) => { request.layers[0]!.input.sourceWidth = 3 },
    (request: RustDocumentMediaInput) => { request.layers[0]!.source = pixels({ rgba: new ArrayBuffer(4) }) },
    (request: RustDocumentMediaInput) => { request.layers[0]!.source = pixels({ originX: 2 }) }
  ]) {
    const request = textInput(); mutate(request)
    await assert.rejects(prepareRustDocumentMedia(request, () => {}), /invalid-input/)
  }
})

test('Worker documental real recebe pixels de texto e compõe tiles independentes', async () => {
  const worker = createRustPixelWorkerHarness({ mediaFixtures: true })
  try {
    await worker.send({ type: 'init', wasm: wasm.slice(0) })
    const prepared = await worker.send({ type: 'prepare-document-media', input: textInput(), generation: 1 })
    if (prepared.type !== 'document-prepared') throw new Error('documento ausente')
    for (const [x, expected] of [[1, [255, 0, 0, 128]], [2, [0, 0, 255, 255]], [0, [0, 0, 0, 0]]] as const) {
      const tile = await worker.send({ type: 'compose-prepared-document', documentId: prepared.documentId,
        region: { x, y: 1, width: 1, height: 1 } })
      if (tile.type !== 'rendered-prepared-document') throw new Error('tile ausente')
      assert.deepEqual([...new Uint8Array(tile.rgba)], expected)
    }
  } finally { await worker.close() }
})

function textPlan(content: string): RustEditorialPlan {
  const source: RustDocumentTextSource = planRustDocumentText({ ...DEFAULT_TEXT_LAYER, content, fontFamily: 'Arial',
    fontSize: 10, baseWidth: 20, baseHeight: 10 }, { x: 1, y: 1, width: 2, height: 1, rotation: 0 }, 3, 2, 1)!
  return { documentWidth: 3, documentHeight: 2, width: 3, height: 2, grid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 },
    layers: [{ source, input: { sourceIdentity: 'text:caption', sourceWidth: source.width, sourceHeight: source.height,
      styles: normalizeLayerStyleConfig({}), globalLight: light, quality: 'final' },
    matrix: [1, 0, 0, 1, source.originX, source.originY], opacity: 100, blendMode: 'normal' }] }
}

test('sessão reutiliza o texto preparado e só rasteriza de novo quando o descritor muda', async () => {
  const rasterized: string[] = []
  const rasterize = (source: RustDocumentTextSource): RustDocumentTextPixels => {
    rasterized.push(source.text.content)
    return { type: 'text-pixels', width: source.width, height: source.height,
      originX: source.originX, originY: source.originY, rgba: glyphs() }
  }
  let alive = 0
  const service = new RustDocumentOffscreen(async () => {
    const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), client = new RustPixelPocWorkerClient(harness.port)
    await client.send({ type: 'init', wasm: wasm.slice(0) }); alive++
    return { get closed() { return client.closed }, send: client.send, cancel: () => {},
      terminate: async () => { await client.terminate(); alive-- } }
  }, (plan, signal) => loadRustDocumentMedia(plan, signal, undefined, rasterize))
  const frames: number[][] = []
  try {
    await service.render(textPlan('Ab'), rgba => frames.push([...rgba]))
    await service.render(textPlan('Ab'), rgba => frames.push([...rgba]))
    assert.deepEqual(rasterized, ['Ab']); assert.equal(service.stats.preparations, 1); assert.equal(service.stats.reuses, 1)
    await service.render(textPlan('Ac'), rgba => frames.push([...rgba]))
    assert.deepEqual(rasterized, ['Ab', 'Ac']); assert.equal(service.stats.preparations, 2)
    assert.equal(service.stats.connections, 1)
    for (const frame of frames) assert.deepEqual(frame, expectedDocument)
  } finally { await service.dispose(); assert.equal(alive, 0) }
})

test('carga de mídia rasteriza texto na thread principal e desconta o saldo sem buscar URL', async () => {
  const reads: string[] = []
  const result = await loadRustDocumentMedia(textPlan('Ab'), new AbortController().signal,
    async url => { reads.push(url); throw new Error('não deveria buscar') },
    source => ({ type: 'text-pixels', width: source.width, height: source.height,
      originX: source.originX, originY: source.originY, rgba: glyphs() }))
  assert.deepEqual(reads, [])
  assert.equal(result.layers[0]!.source.type, 'text-pixels')
})
