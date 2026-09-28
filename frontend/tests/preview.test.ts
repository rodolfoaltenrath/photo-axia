import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canReuseVisibleRasterForInteraction,
  imageSourceForImmediateInteraction,
  imageSourceForRasterSize,
  shouldUpdateActiveImageTransform,
  snapCanvasTranslation,
  viewportPreviewGeometry
} from '../src/editor/preview.ts'

test('raster visível acompanha Ctrl+T enquanto a nova prévia carrega em outro buffer', () => {
  assert.equal(shouldUpdateActiveImageTransform(1, 0, true), true)
  assert.equal(shouldUpdateActiveImageTransform(1, 0, false), false)
  assert.equal(shouldUpdateActiveImageTransform(0, 0, false), true)
})

test('movimento de seleção reutiliza o raster decodificado que já está visível', () => {
  const visible = { complete: true, naturalWidth: 800, naturalHeight: 600 }
  assert.equal(canReuseVisibleRasterForInteraction(visible, false), true)
  assert.equal(canReuseVisibleRasterForInteraction(visible, true), false)
  assert.equal(canReuseVisibleRasterForInteraction({ ...visible, complete: false }, false), false)
  assert.equal(canReuseVisibleRasterForInteraction({ ...visible, naturalWidth: 0 }, false), false)
})

test('interação imediata prefere a prévia mesmo quando o raster definitivo é maior', () => {
  assert.equal(imageSourceForImmediateInteraction({
    width: 4000,
    height: 3000,
    mimeType: 'image/png',
    sourceUrl: 'original.png',
    previewUrl: 'preview.webp'
  }), 'preview.webp')
  assert.equal(imageSourceForImmediateInteraction({
    width: 4000,
    height: 3000,
    mimeType: 'image/png',
    sourceUrl: 'original.png'
  }), 'original.png')
})

const asset = {
  width: 4000,
  height: 3000,
  mimeType: 'image/png',
  sourceUrl: 'original.png',
  previewUrl: 'preview.webp',
  previewWidth: 1000,
  previewHeight: 750
}

test('mantém a prévia leve quando ela cobre a densidade visual necessária', () => {
  assert.equal(imageSourceForRasterSize(asset, 1000, 750), 'preview.webp')
  assert.equal(imageSourceForRasterSize(asset, 800, 600), 'preview.webp')
})

test('usa o raster original apenas quando o thumbnail seria ampliado', () => {
  assert.equal(imageSourceForRasterSize(asset, 1001, 750), 'original.png')
  assert.equal(imageSourceForRasterSize(asset, 1000, 751), 'original.png')
})

test('limita a resolução pedida ao tamanho real do raster', () => {
  const fullPreview = { ...asset, previewWidth: 4000, previewHeight: 3000 }
  assert.equal(imageSourceForRasterSize(fullPreview, 8000, 6000), 'preview.webp')
})

test('alinha a composição móvel aos pixels físicos do canvas', () => {
  assert.equal(snapCanvasTranslation(12.49), 12)
  assert.equal(snapCanvasTranslation(12.5), 13)
  assert.equal(snapCanvasTranslation(Number.NaN), 0)
})

test('rasteriza somente a interseção visível do documento', () => {
  assert.deepEqual(
    viewportPreviewGeometry(
      4000,
      3000,
      0.5,
      2,
      { left: -500, top: -250, right: 1500, bottom: 1250 },
      { left: 0, top: 0, right: 1000, bottom: 750 }
    ),
    { x: 1000, y: 500, width: 2000, height: 1500, rasterWidth: 2000, rasterHeight: 1500 }
  )
})

test('limita os pixels da área visível sem depender do tamanho do documento', () => {
  const geometry = viewportPreviewGeometry(
    50000,
    40000,
    1,
    2,
    { left: 0, top: 0, right: 50000, bottom: 40000 },
    { left: 0, top: 0, right: 3840, bottom: 2160 },
    4_194_304
  )
  assert.ok(geometry.rasterWidth * geometry.rasterHeight <= 4_194_304)
  assert.equal(geometry.width, 3840)
  assert.equal(geometry.height, 2160)
})
