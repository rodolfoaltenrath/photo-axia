import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import { RustPixelPocStyleSession, RustPixelPocStyleCancelledError } from '../../src/editor/rustPixelPocStyleSession.ts'
import { DEFAULT_TEXT_LAYER } from '../../src/editor/text.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'
import { rustMediaBlob } from './support/rustMediaFixture.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const region = { x: 0, y: 0, width: 1, height: 1 }
const input = { sourceIdentity: 'media-v1', sourceWidth: 1, sourceHeight: 1,
  styles: normalizeLayerStyleConfig({}), globalLight: { angle: 30, altitude: 30 } }
const pattern = { id: 'pattern', name: 'fixture', width: 1, height: 1, mimeType: 'image/png', sourceUrl: 'data:image/png;base64,AA==' }

test('Decode de textura/padrão alimenta bisel/traçado e tiles com paridade raster TS', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), session = new RustPixelPocStyleSession(harness.send)
  const styles = normalizeLayerStyleConfig({ fillOpacity: 37.5, effects: [
    { type: 'outer-glow', id: 'glow', size: 2 },
    { type: 'bevel-emboss', id: 'bevel', size: 1, style: 'outer-bevel', textureEnabled: true, texture: pattern, textureDepth: 75 },
    { type: 'stroke', id: 'stroke', size: 2, position: 'outside', paint: { type: 'pattern', pattern, angle: 33.5, scale: 150 } }
  ] })
  const pixels = [120, 40, 200, 255]
  const expected = composeLayerStyleRaster({ width: 1, height: 1, data: new Uint8ClampedArray([40, 60, 80, 255]) },
    styles, input.globalLight, 1, new Map([[pattern.id, { width: 1, height: 1, data: new Uint8ClampedArray(pixels) }]]))
  const args = { ...input, styles, patterns: { pattern: rustMediaBlob({ rgba: pixels }) },
    source: async () => ({ type: 'raster' as const, blob: rustMediaBlob() }) }
  try {
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    const full = await session.composeMedia(args)
    assert.equal(full.width, expected.width); assert.equal(full.height, expected.height)
    assert.equal(full.offsetX, expected.offsetX); assert.equal(full.offsetY, expected.offsetY)
    assert.deepEqual(new Uint8Array(full.rgba), new Uint8Array(expected.data))
    for (let y = 0; y < full.height; y++) {
      const row = await session.composeMedia({ ...args, region: { x: 0, y, width: full.width, height: 1 } })
      assert.equal(row.sourceId, full.sourceId)
      assert.deepEqual(new Uint8Array(row.rgba), new Uint8Array(expected.data.slice(y * full.width * 4, (y + 1) * full.width * 4)))
    }
  } finally { await session.dispose(); await harness.close() }
})

test('Sessão de mídia decodifica no Worker, aplica STG1 e reutiliza fonte entre estilos/tiles', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), session = new RustPixelPocStyleSession(harness.send)
  let loads = 0
  const source = async () => { loads++; return { type: 'raster' as const, blob: rustMediaBlob() } }
  try {
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    const styles = normalizeLayerStyleConfig({ fillOpacity: 0, effects: [
      { type: 'drop-shadow', color: '#ff0000', size: 0, distance: 1, angle: 0,
        useGlobalLight: false, opacity: 100, layerKnocksOutShadow: false },
      { type: 'color-overlay', color: '#0000ff', opacity: 50 }
    ] })
    const result = await session.composeMedia({ ...input, styles, source })
    assert.deepEqual([...new Uint8Array(result.rgba)], [255, 0, 0, 255, 0, 0, 255, 128])
    assert.equal(result.offsetX, -1); assert.equal(result.width, 2)
    const tile = await session.composeMedia({ ...input, styles: normalizeLayerStyleConfig({ ...styles, fillOpacity: 100 }),
      region: { ...region, x: 1 }, source })
    assert.equal(loads, 1); assert.equal(result.sourceId, tile.sourceId)
    assert.deepEqual([...new Uint8Array(tile.rgba)], [20, 30, 168, 255]); assert.equal(tile.offsetX, 0)
    assert.ok(Number.isFinite(tile.timings.copyInMs) && tile.timings.copyInMs >= 0)
  } finally { await session.dispose(); await harness.close() }
})

test('Padrão alterado é decodificado novamente sem reupload da fonte; erro não envenena fila', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), session = new RustPixelPocStyleSession(harness.send)
  const args = { ...input, styles: normalizeLayerStyleConfig({ fillOpacity: 0, effects: [{ type: 'pattern-overlay', pattern }] }),
    source: async () => ({ type: 'raster' as const, blob: rustMediaBlob() }) }
  try {
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    const first = await session.composeMedia({ ...args, patterns: { pattern: rustMediaBlob({ rgba: [255, 0, 0, 255] }) } })
    const second = await session.composeMedia({ ...args, patterns: { pattern: rustMediaBlob({ rgba: [0, 255, 0, 255] }) } })
    assert.equal(first.sourceId, second.sourceId)
    assert.deepEqual([...new Uint8Array(first.rgba)], [255, 0, 0, 255])
    assert.deepEqual([...new Uint8Array(second.rgba)], [0, 255, 0, 255])
    await assert.rejects(session.composeMedia({ ...args, patterns: { pattern: rustMediaBlob({ width: 2 }) } }), /invalid-input/)
    const recovered = await session.composeMedia({ ...args, patterns: { pattern: rustMediaBlob() } })
    assert.equal(recovered.sourceId, first.sourceId)
    assert.deepEqual([...new Uint8Array(recovered.rgba)], [40, 60, 80, 255])
  } finally { await session.dispose(); await harness.close() }
})

test('Invalidação durante decode impede upload antigo; geração reservada continua utilizável', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), { send } = harness
  try {
    await send({ type: 'init', wasm: wasm.slice(0) })
    const delayed = send({ type: 'stage-style-media', input, source: { type: 'raster', blob: rustMediaBlob({ delayMs: 60 }) }, generation: 1 })
    assert.equal((await send({ type: 'invalidate-source', generation: 2 })).type, 'source-invalidated')
    const next = send({ type: 'stage-style-media', input, source: { type: 'raster', blob: rustMediaBlob({ rgba: [1, 2, 3, 255] }) }, generation: 2 })
    const obsolete = await delayed
    assert.ok(obsolete.type === 'error' && obsolete.code === 'invalid-input')
    const staged = await next; assert.ok(staged.type === 'source-staged')
    const result = await send({ type: 'style-media-staged-region', input, sourceId: staged.sourceId, region, patterns: {} })
    assert.ok(result.type === 'rendered-staged-region')
    assert.deepEqual([...new Uint8Array(result.rgba)], [1, 2, 3, 255])
  } finally { await harness.close() }
})

test('Dispose/reinit não permite resposta de mídia do runtime anterior', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), { send } = harness
  try {
    await send({ type: 'init', wasm: wasm.slice(0) })
    const delayed = send({ type: 'stage-style-media', input, source: { type: 'raster', blob: rustMediaBlob({ delayMs: 60 }) }, generation: 1 })
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
    assert.equal((await send({ type: 'init', wasm: wasm.slice(0) })).type, 'ready')
    assert.equal((await delayed).type, 'cancelled')
    const staged = await send({ type: 'stage-style-media', input, source: { type: 'raster', blob: rustMediaBlob() }, generation: 1 })
    assert.ok(staged.type === 'source-staged')
  } finally { await harness.close() }
})

test('Cancelamento de render com assets não cancela fonte; geometria/identidade erradas são rejeitadas', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), { send } = harness
  try {
    await send({ type: 'init', wasm: wasm.slice(0) })
    const staged = await send({ type: 'stage-style-media', input, source: { type: 'raster', blob: rustMediaBlob() }, generation: 1 })
    assert.ok(staged.type === 'source-staged')
    const styled = { ...input, styles: normalizeLayerStyleConfig({ effects: [{ type: 'pattern-overlay', pattern }] }) }
    const render = send({ type: 'style-media-staged-region', input: styled, sourceId: staged.sourceId, region,
      patterns: { pattern: rustMediaBlob({ delayMs: 60 }) } })
    harness.cancel(render.id)
    assert.equal((await render).type, 'cancelled')
    for (const bad of [{ ...input, sourceIdentity: 'wrong' }, { ...input, sourceWidth: 2 }]) {
      const result = await send({ type: 'style-media-staged-region', input: bad, sourceId: staged.sourceId, region, patterns: {} })
      assert.ok(result.type === 'error' && result.code === 'invalid-input')
    }
    const recovered = await send({ type: 'style-media-staged-region', input, sourceId: staged.sourceId, region, patterns: {} })
    assert.equal(recovered.type, 'rendered-staged-region')
  } finally { await harness.close() }
})

test('Troca de fonte durante decode de asset preserva o upload novo e rejeita o tile antigo', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), { send } = harness
  try {
    await send({ type: 'init', wasm: wasm.slice(0) })
    const staged = await send({ type: 'stage-style-media', input, source: { type: 'raster', blob: rustMediaBlob() }, generation: 1 })
    assert.ok(staged.type === 'source-staged')
    const render = send({ type: 'style-media-staged-region',
      input: { ...input, styles: normalizeLayerStyleConfig({ effects: [{ type: 'pattern-overlay', pattern }] }) },
      sourceId: staged.sourceId, region, patterns: { pattern: rustMediaBlob({ delayMs: 60 }) } })
    const next = await send({ type: 'stage-source', generation: 2, sourceWidth: 1, sourceHeight: 1,
      rgba: new Uint8Array([1, 2, 3, 255]).buffer })
    assert.ok(next.type === 'source-staged')
    const obsolete = await render
    assert.ok(obsolete.type === 'error' && obsolete.code === 'invalid-input')
    const result = await send({ type: 'render-staged-region', sourceId: next.sourceId, region, fillOpacity: 100 })
    assert.ok(result.type === 'rendered-staged-region')
    assert.deepEqual([...new Uint8Array(result.rgba)], [1, 2, 3, 255])
  } finally { await harness.close() }
})

test('Texto passa pelo caminho existente no Worker; raw/media não compartilham cache de origem', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), session = new RustPixelPocStyleSession(harness.send)
  try {
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    const text = await session.composeMedia({ ...input, source: async () => ({ type: 'text' as const, text: DEFAULT_TEXT_LAYER,
      drawScaleX: 1, drawScaleY: 1 }) })
    assert.deepEqual([...new Uint8Array(text.rgba)], [0, 0, 0, 255])
    const raw = await session.compose({ ...input, source: async () => ({ width: 1, height: 1,
      data: new Uint8ClampedArray([40, 60, 80, 255]) }) })
    assert.notEqual(text.sourceId, raw.sourceId)
    assert.deepEqual([...new Uint8Array(raw.rgba)], [40, 60, 80, 255])
  } finally { await session.dispose(); await harness.close() }
})

test('Sessão descarta composeMedia obsoleto e permite recuperação de decode corrompido', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), session = new RustPixelPocStyleSession(harness.send)
  try {
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    let release!: () => void
    const wait = new Promise<void>(resolve => { release = resolve })
    const pending = session.composeMedia({ ...input, source: async () => { await wait; return { type: 'raster', blob: rustMediaBlob() } } })
    const rejected = assert.rejects(pending, error => error instanceof RustPixelPocStyleCancelledError)
    await session.invalidate(); release(); await rejected
    await assert.rejects(session.composeMedia({ ...input, source: async () => ({ type: 'raster', blob: new Blob(['bad']) }) }), /invalid-input/)
    const next = await session.composeMedia({ ...input, source: async () => ({ type: 'raster', blob: rustMediaBlob() }) })
    assert.deepEqual([...new Uint8Array(next.rgba)], [40, 60, 80, 255])
  } finally { await session.dispose(); await harness.close() }
})

test('Preflight da sessão rejeita região/assets antes do loader e compartilha preparação concorrente', async () => {
  const harness = createRustPixelWorkerHarness({ mediaFixtures: true }), session = new RustPixelPocStyleSession(harness.send)
  let loads = 0
  const source = async () => { loads++; return { type: 'raster' as const, blob: rustMediaBlob({ delayMs: 20 }) } }
  try {
    await harness.send({ type: 'init', wasm: wasm.slice(0) })
    await assert.rejects(session.composeMedia({ ...input, source, region: { ...region, x: 1 } }), /invalid-input/)
    await assert.rejects(session.composeMedia({ ...input, source,
      styles: normalizeLayerStyleConfig({ effects: [{ type: 'pattern-overlay', pattern }] }) }), /invalid-input/)
    assert.equal(loads, 0)
    const first = session.composeMedia({ ...input, source })
    const rejected = assert.rejects(first, error => error instanceof RustPixelPocStyleCancelledError)
    const second = session.composeMedia({ ...input, source })
    await rejected
    assert.deepEqual([...new Uint8Array((await second).rgba)], [40, 60, 80, 255])
    assert.equal(loads, 1)
  } finally { await session.dispose(); await harness.close() }
})
