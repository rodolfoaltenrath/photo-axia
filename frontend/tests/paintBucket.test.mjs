import assert from 'node:assert/strict'
import test from 'node:test'
import { colorRegionSpans } from '../src/editor/colorRegion.ts'
import {
  applyPaintBucketColorRegion,
  applyPaintBucketColorRegionCooperatively,
  applyPaintBucketRaster
} from '../src/editor/paintBucket.ts'

const rgba = (...pixels) => new Uint8ClampedArray(pixels.flat())
const identity = [1, 0, 0, 1, 0, 0]

test('preenche exatamente os spans encontrados pelo motor compartilhado', () => {
  const source = rgba([10, 10, 10, 255], [10, 10, 10, 255], [200, 200, 200, 255])
  const region = colorRegionSpans(source, 3, 1, { startX: 0, startY: 0, tolerance: 0, contiguous: true })
  const result = applyPaintBucketRaster({
    pixels: source, width: 3, height: 1, region, color: '#ff0000', selection: null, sourceToDocument: identity
  })
  assert.equal(result.changedPixelCount, 2)
  assert.deepEqual([...result.pixels], [255, 0, 0, 255, 255, 0, 0, 255, 200, 200, 200, 255])
  assert.deepEqual([...source], [10, 10, 10, 255, 10, 10, 10, 255, 200, 200, 200, 255])
})

test('intersecta a região com a seleção sem alterar a seleção', () => {
  const source = rgba([0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0])
  const region = colorRegionSpans(source, 3, 1, { startX: 0, startY: 0, tolerance: 0, contiguous: true })
  const selection = { kind: 'rectangle', bounds: { x: 1, y: 0, width: 1, height: 1 } }
  const snapshot = structuredClone(selection)
  const result = applyPaintBucketRaster({
    pixels: source, width: 3, height: 1, region, color: '#00ff00', selection, sourceToDocument: identity
  })
  assert.equal(result.changedPixelCount, 1)
  assert.deepEqual([...result.pixels], [0, 0, 0, 0, 0, 255, 0, 255, 0, 0, 0, 0])
  assert.deepEqual(selection, snapshot)
})

test('preenchimento idêntico é no-op e cor inválida é rejeitada', () => {
  const source = rgba([1, 2, 3, 255])
  const region = colorRegionSpans(source, 1, 1, { startX: 0, startY: 0, tolerance: 0, contiguous: true })
  assert.equal(applyPaintBucketRaster({
    pixels: source, width: 1, height: 1, region, color: '#010203', selection: null, sourceToDocument: identity
  }).changedPixelCount, 0)
  assert.equal(applyPaintBucketRaster({
    pixels: source, width: 1, height: 1, region, color: '#010203', selection: null, sourceToDocument: identity
  }).pixels, undefined)
  assert.throws(() => applyPaintBucketRaster({
    pixels: source, width: 1, height: 1, region, color: 'red', selection: null, sourceToDocument: identity
  }), /cor do Balde de Tinta/)
})

test('preenche região fragmentada sem materializar objetos de span', () => {
  const source = rgba([0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255])
  const result = applyPaintBucketColorRegion({
    pixels: source, width: 3, height: 1, color: '#ff0000', selection: null, sourceToDocument: identity,
    regionOptions: { startX: 0, startY: 0, tolerance: 0, contiguous: false }
  })
  assert.equal(result.changedPixelCount, 2)
  assert.deepEqual([...result.pixels], [255, 0, 0, 255, 255, 255, 255, 255, 255, 0, 0, 255])
})

test('fallback cooperativo cede controle e observa cancelamento entre lotes', async () => {
  const source = rgba([0, 0, 0, 255], [255, 255, 255, 255], [0, 0, 0, 255])
  let yielded = 0
  let cancelled = false
  await assert.rejects(() => applyPaintBucketColorRegionCooperatively({
    pixels: source, width: 3, height: 1, color: '#ff0000', selection: null, sourceToDocument: identity,
    regionOptions: { startX: 0, startY: 0, tolerance: 0, contiguous: false }
  }, {
    spansPerChunk: 1,
    yieldControl: async () => { yielded += 1; cancelled = true },
    throwIfCancelled: () => { if (cancelled) throw new DOMException('Cancelado', 'AbortError') }
  }), { name: 'AbortError' })
  assert.equal(yielded, 1)
})
