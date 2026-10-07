import assert from 'node:assert/strict'
import test from 'node:test'
import { decodeRustStyleSource, decodeRustStyleAssets, prepareRustStyleAssets } from '../../src/editor/rustPixelPocMedia.ts'
import { prepareRustStyleSourceLayout } from '../../src/editor/rustPixelPocStylePreparation.ts'
import { RustPixelPocMediaQueue } from '../../src/editor/rustPixelPocMediaQueue.ts'
import { RustPixelPocError } from '../../src/editor/rustPixelPocError.ts'
import { DEFAULT_TEXT_LAYER } from '../../src/editor/text.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { installRustMediaFixtures, rustMediaBlob } from './support/rustMediaFixture.ts'
import { emptyRustStyleDecodeTimings } from '../../src/editor/rustStyleMediaTimings.ts'

const input = { sourceIdentity: 'fixture', sourceWidth: 2, sourceHeight: 1,
  styles: normalizeLayerStyleConfig({}), globalLight: { angle: 30, altitude: 30 } }
const layout = prepareRustStyleSourceLayout(input)
const pattern = { id: 'pattern', name: 'fixture', width: 1, height: 1, mimeType: 'image/png', sourceUrl: 'data:image/png;base64,AA==' }
const assetLayout = prepareRustStyleSourceLayout({ ...input, styles: normalizeLayerStyleConfig({ effects: [
  { type: 'pattern-overlay', id: 'overlay', pattern },
  { type: 'stroke', id: 'stroke', size: 1, paint: { type: 'pattern', pattern } }
] }) })
const noop = () => {}
const errorCode = (code: string) => (error: unknown) => error instanceof RustPixelPocError && error.code === code

test('Decode raster respeita qualidade e limpa bitmap/canvas antes de devolver pixels', async () => {
  const { state, restore } = installRustMediaFixtures()
  try {
    for (const quality of ['interactive', 'final'] as const) {
      const result = await decodeRustStyleSource({ type: 'raster', blob: rustMediaBlob() }, { ...layout, quality }, noop)
      assert.deepEqual([...result.data], [40, 60, 80, 255, 40, 60, 80, 255])
      assert.deepEqual(state.options.at(-1), { resizeWidth: 2, resizeHeight: 1, resizeQuality: quality === 'final' ? 'high' : 'medium' })
      assert.equal(state.closes, state.decodes)
      assert.ok(state.canvases.every(canvas => canvas.width === 1 && canvas.height === 1))
    }
  } finally { restore() }
})

test('Decode obsoleto fecha bitmap sem readback; erro de readback também limpa recursos', async () => {
  const { state, restore } = installRustMediaFixtures()
  try {
    let current = true, unblock!: () => void
    state.block = new Promise<void>(resolve => { unblock = resolve })
    const result = decodeRustStyleSource({ type: 'raster', blob: rustMediaBlob() }, layout, () => {
      if (!current) throw new RustPixelPocError('invalid-input')
    })
    while (!state.decodes) await new Promise(resolve => setImmediate(resolve))
    current = false; unblock()
    await assert.rejects(result, errorCode('invalid-input'))
    assert.equal(state.closes, 1); assert.equal(state.reads, 0); assert.equal(state.canvases.length, 0)
    state.block = null
    await assert.rejects(decodeRustStyleSource({ type: 'raster', blob: rustMediaBlob({ failRead: true }) }, layout, noop), /readback-failed/)
    assert.equal(state.closes, 2)
    assert.ok(state.canvases.every(canvas => canvas.width === 1 && canvas.height === 1))
  } finally { restore() }
})

test('Texto usa o layout existente, sem decoder raster; entradas abusivas são rejeitadas', async () => {
  const { state, restore } = installRustMediaFixtures()
  try {
    const source = { type: 'text' as const, text: { ...DEFAULT_TEXT_LAYER }, drawScaleX: 1, drawScaleY: 1 }
    const result = await decodeRustStyleSource(source, layout, noop)
    assert.equal(result.data[3], 255); assert.equal(state.decodes, 0); assert.ok(state.textDraws > 0)
    for (const invalid of [{ ...source, drawScaleX: 0 }, { ...source, drawScaleY: NaN },
      { ...source, text: { ...source.text, content: 'a'.repeat(20_001) } },
      { ...source, text: { ...source.text, fontSize: Infinity } }]) {
      await assert.rejects(decodeRustStyleSource(invalid, layout, noop), errorCode('invalid-input'))
    }
    assert.ok(state.canvases.every(canvas => canvas.width === 1 && canvas.height === 1))
  } finally { restore() }
})

test('Assets ativos são deduplicados, decodificados sequencialmente e limpos', async () => {
  const { state, restore } = installRustMediaFixtures()
  try {
    const assets = prepareRustStyleAssets(assetLayout, { pattern: rustMediaBlob() })
    assert.equal(assets.entries.length, 1); assert.equal(assets.decodedBytes, 4)
    const decoded = await decodeRustStyleAssets(assets, noop)
    assert.deepEqual([...decoded.get('pattern')!.rgba], [40, 60, 80, 255])
    assert.equal(state.decodes, 1); assert.equal(state.closes, 1)
    assert.ok(state.canvases.every(canvas => canvas.width === 1 && canvas.height === 1))
    const inactive = prepareRustStyleSourceLayout({ ...input, styles: { ...assetLayout.styles, enabled: false } })
    assert.equal(prepareRustStyleAssets(inactive, {}).entries.length, 0)
  } finally { restore() }
})

test('Assets sem Blob, inconsistentes, grandes ou com dimensões reais diferentes falham antes do readback', async () => {
  const { state, restore } = installRustMediaFixtures()
  try {
    assert.throws(() => prepareRustStyleAssets(assetLayout, {}), errorCode('invalid-input'))
    const large = prepareRustStyleSourceLayout({ ...input, styles: normalizeLayerStyleConfig({ effects: [
      { type: 'pattern-overlay', pattern: { ...pattern, width: 4096, height: 4096 } }
    ] }) })
    assert.throws(() => prepareRustStyleAssets(large, { pattern: rustMediaBlob() }), errorCode('memory-limit'))
    const conflict = prepareRustStyleSourceLayout({ ...input, styles: normalizeLayerStyleConfig({ effects: [
      { type: 'pattern-overlay', pattern }, { type: 'stroke', paint: { type: 'pattern', pattern: { ...pattern, width: 2 } } }
    ] }) })
    assert.throws(() => prepareRustStyleAssets(conflict, { pattern: rustMediaBlob() }), errorCode('invalid-input'))
    const mismatched = prepareRustStyleAssets(assetLayout, { pattern: rustMediaBlob({ width: 2 }) })
    await assert.rejects(decodeRustStyleAssets(mismatched, noop), errorCode('invalid-input'))
    assert.equal(state.decodes, 0); assert.equal(state.closes, 0); assert.equal(state.reads, 0)
  } finally { restore() }
})

test('Blob vazio/corrompido e plataforma sem decoder retornam erros explícitos', async () => {
  const { state, restore } = installRustMediaFixtures()
  try {
    await assert.rejects(decodeRustStyleSource({ type: 'raster', blob: new Blob() }, layout, noop), errorCode('invalid-input'))
    await assert.rejects(decodeRustStyleSource({ type: 'raster', blob: new Blob(['bad']) }, layout, noop), errorCode('invalid-input'))
    assert.equal(state.canvases.length, 0)
    Reflect.deleteProperty(globalThis, 'createImageBitmap')
    await assert.rejects(decodeRustStyleSource({ type: 'raster', blob: rustMediaBlob() }, layout, noop), errorCode('wasm-unavailable'))
  } finally { restore() }
})

test('Mais de um asset é decodificado em sequência; limites incluem Blobs extras', async () => {
  const { state, restore } = installRustMediaFixtures()
  try {
    const decoder = globalThis.createImageBitmap
    globalThis.createImageBitmap = ((...args: Parameters<typeof createImageBitmap>) => {
      assert.equal(state.decodes, state.closes)
      return decoder(...args)
    }) as typeof createImageBitmap
    const second = { ...pattern, id: 'second' }
    const both = prepareRustStyleSourceLayout({ ...input, styles: normalizeLayerStyleConfig({ effects: [
      { type: 'pattern-overlay', pattern }, { type: 'bevel-emboss', textureEnabled: true, texture: second }
    ] }) })
    const assets = prepareRustStyleAssets(both, { pattern: rustMediaBlob(), second: rustMediaBlob() })
    assert.equal((await decodeRustStyleAssets(assets, noop)).size, 2)
    assert.equal(state.decodes, 2); assert.equal(state.closes, 2)
    assert.throws(() => prepareRustStyleAssets(layout, Object.fromEntries(Array.from({ length: 65 }, (_, i) => [String(i), rustMediaBlob()]))), errorCode('invalid-input'))
    class OversizedBlob extends Blob { override get size() { return 64 * 1024 * 1024 + 1 } }
    assert.throws(() => prepareRustStyleAssets(layout, { unused: new OversizedBlob(['x']) }), errorCode('memory-limit'))
    await assert.rejects(decodeRustStyleSource({ type: 'raster', blob: new OversizedBlob(['x']) }, layout, noop), errorCode('memory-limit'))
    assert.equal(state.decodes, 2)
  } finally { restore() }
})

test('Fila serial limita pendências e se recupera de falha sem bloquear o próximo trabalho', async () => {
  const queue = new RustPixelPocMediaQueue(), order: number[] = []
  let release!: () => void
  const wait = new Promise<void>(resolve => { release = resolve })
  const first = queue.run(async () => { order.push(0); await wait; throw new Error('decode-failed') })
  const rejection = assert.rejects(first, /decode-failed/)
  const next = Array.from({ length: 7 }, (_, index) => queue.run(async () => { order.push(index + 1); return index + 1 }))
  await assert.rejects(queue.run(async () => 9), errorCode('memory-limit'))
  assert.deepEqual(order, [0]); release()
  await rejection; assert.deepEqual(await Promise.all(next), [1, 2, 3, 4, 5, 6, 7])
  assert.deepEqual(order, [0, 1, 2, 3, 4, 5, 6, 7])
  assert.equal(await queue.run(async () => 8), 8)
})

test('Fonte intrínseca enorme não chega ao decoder mesmo se o preview solicitado for pequeno', async () => {
  const { state, restore } = installRustMediaFixtures()
  try {
    for (const size of [{ width: 4097, height: 4096 }, { width: 16_385, height: 1 }]) {
      await assert.rejects(decodeRustStyleSource({ type: 'raster', blob: rustMediaBlob(size) }, layout, noop), errorCode('memory-limit'))
    }
    assert.equal(state.decodes, 0); assert.equal(state.canvases.length, 0)
    assert.equal((await decodeRustStyleSource({ type: 'raster', blob: rustMediaBlob() }, layout, noop)).data[0], 40)
    assert.equal(state.decodes, 1); assert.equal(state.closes, 1)
  } finally { restore() }
})

test('Orçamento de decode soma origem intrínseca, bitmap redimensionado, canvas e readback', async () => {
  const { state, restore } = installRustMediaFixtures()
  try {
    const bigger = prepareRustStyleSourceLayout({ ...input, sourceWidth: 2048, sourceHeight: 2048 })
    await assert.rejects(decodeRustStyleSource({ type: 'raster', blob: rustMediaBlob({ width: 4096, height: 4096 }) }, bigger, noop), errorCode('memory-limit'))
    assert.equal(state.decodes, 0); assert.equal(state.canvases.length, 0)
    await decodeRustStyleSource({ type: 'raster', blob: rustMediaBlob({ width: 4096, height: 4096 }) }, layout, noop)
    assert.equal(state.decodes, 1); assert.equal(state.reads, 1)
  } finally { restore() }
})

test('Padrão com cabeçalho enorme ou incompatível falha antes do decoder', async () => {
  const { state, restore } = installRustMediaFixtures()
  try {
    for (const [size, code] of [[{ width: 8192, height: 8192 }, 'memory-limit'], [{ width: 2, height: 1 }, 'invalid-input']] as const) {
      await assert.rejects(decodeRustStyleAssets(prepareRustStyleAssets(assetLayout, { pattern: rustMediaBlob(size) }), noop), errorCode(code))
    }
    assert.equal(state.decodes, 0); assert.equal(state.reads, 0)
    assert.equal((await decodeRustStyleAssets(prepareRustStyleAssets(assetLayout, { pattern: rustMediaBlob() }), noop)).size, 1)
  } finally { restore() }
})

test('Cabeçalho desconhecido não invoca decoder; MIME incorreto não impede PNG reconhecido', async () => {
  const { state, restore } = installRustMediaFixtures()
  try {
    await assert.rejects(decodeRustStyleSource({ type: 'raster', blob: new Blob(['<svg/>'], { type: 'image/png' }) }, layout, noop), errorCode('invalid-input'))
    assert.equal(state.decodes, 0)
    await decodeRustStyleSource({ type: 'raster', blob: new Blob([rustMediaBlob()], { type: 'application/octet-stream' }) }, layout, noop)
    assert.equal(state.decodes, 1)
  } finally { restore() }
})

test('Bitmap que ignora resize é fechado sem criar canvas; padrão confere dimensões reais', async () => {
  const { state, restore } = installRustMediaFixtures()
  try {
    globalThis.createImageBitmap = (async () => ({ width: 2, height: 2, close() { state.closes++ } })) as unknown as typeof createImageBitmap
    await assert.rejects(decodeRustStyleSource({ type: 'raster', blob: rustMediaBlob() }, layout, noop), errorCode('invalid-input'))
    await assert.rejects(decodeRustStyleAssets(prepareRustStyleAssets(assetLayout, { pattern: rustMediaBlob() }), noop), errorCode('invalid-input'))
    assert.equal(state.closes, 2); assert.equal(state.canvases.length, 0)
  } finally { restore() }
})

test('Axes trocados no cabeçalho permitem EXIF mas não dispensam validação após decode', async () => {
  const { state, restore } = installRustMediaFixtures()
  try {
    const rotatedLayout = prepareRustStyleSourceLayout({ ...input, styles: normalizeLayerStyleConfig({ effects: [
      { type: 'pattern-overlay', pattern: { ...pattern, width: 2, height: 1 } }
    ] }) })
    const prepared = prepareRustStyleAssets(rotatedLayout, { pattern: rustMediaBlob({ width: 1, height: 2 }) })
    await assert.rejects(decodeRustStyleAssets(prepared, noop), errorCode('invalid-input'))
    globalThis.createImageBitmap = (async () => ({ width: 2, height: 1, rgba: [1, 2, 3, 255], close() { state.closes++ } })) as unknown as typeof createImageBitmap
    assert.equal((await decodeRustStyleAssets(prepared, noop)).get('pattern')!.width, 2)
  } finally { restore() }
})

test('Métricas separam decode raster, readback e desenho de texto sem mudar pixels', async () => {
  const { restore } = installRustMediaFixtures()
  try {
    const raster = emptyRustStyleDecodeTimings()
    const result = await decodeRustStyleSource({ type: 'raster', blob: rustMediaBlob({ delayMs: 40 }) }, layout, noop, raster)
    assert.equal(raster.rasterDecodes, 1); assert.equal(raster.textDraws, 0); assert.equal(raster.rgbaBytes, result.data.byteLength)
    assert.ok(raster.bitmapMs >= 30)
    assert.ok(Object.values(raster).every(value => Number.isFinite(value) && value >= 0))
    const text = emptyRustStyleDecodeTimings()
    await decodeRustStyleSource({ type: 'text', text: DEFAULT_TEXT_LAYER, drawScaleX: 1, drawScaleY: 1 }, layout, noop, text)
    assert.equal(text.rasterDecodes, 0); assert.equal(text.textDraws, 1); assert.equal(text.bitmapMs, 0); assert.equal(text.headerMs, 0)
    assert.equal(text.rgbaBytes, 8)
  } finally { restore() }
})

test('Métricas acumulam padrões distintos sem confundir contadores com a fonte', async () => {
  const { restore } = installRustMediaFixtures()
  try {
    const second = { ...pattern, id: 'second' }
    const both = prepareRustStyleSourceLayout({ ...input, styles: normalizeLayerStyleConfig({ effects: [
      { type: 'pattern-overlay', pattern }, { type: 'bevel-emboss', textureEnabled: true, texture: second }
    ] }) })
    const timings = emptyRustStyleDecodeTimings()
    const decoded = await decodeRustStyleAssets(prepareRustStyleAssets(both, { pattern: rustMediaBlob(), second: rustMediaBlob() }), noop, timings)
    assert.equal(decoded.size, 2); assert.equal(timings.rasterDecodes, 2); assert.equal(timings.rgbaBytes, 8)
    assert.equal(timings.textDraws, 0)
  } finally { restore() }
})
