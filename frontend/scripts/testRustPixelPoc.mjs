import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { composeLayerStyleRaster } from '../src/editor/layerStyleRaster.ts'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'

const wasmPath = new URL('../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url)
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {})
const { memory, axia_poc_alloc: alloc, axia_poc_free: free,
  axia_poc_fill_opacity: apply, axia_poc_fill_opacity_region: applyRegion } = instance.exports
const light = { angle: 0, altitude: 30 }

function rustRegion(source, sourceWidth, sourceHeight, region, opacity) {
  const outputLength = region.width * region.height * 4
  const sourcePtr = alloc(source.length)
  assert.ok(sourcePtr > 0)
  let outputPtr = 0
  try {
    outputPtr = alloc(outputLength)
    assert.ok(outputPtr > 0)
    new Uint8Array(memory.buffer, sourcePtr, source.length).set(source)
    assert.equal(applyRegion(sourcePtr, source.length, sourceWidth, sourceHeight,
      region.x, region.y, region.width, region.height, outputPtr, outputLength, opacity), 0)
    return new Uint8Array(memory.buffer, outputPtr, outputLength).slice()
  } finally {
    if (outputPtr) free(outputPtr, outputLength)
    free(sourcePtr, source.length)
  }
}

function rustFillOpacity(source, opacity) {
  const ptr = alloc(source.length)
  assert.ok(ptr > 0, 'WASM não conseguiu alocar o buffer de teste')
  try {
    new Uint8Array(memory.buffer, ptr, source.length).set(source)
    assert.equal(apply(ptr, source.length, opacity), 0)
    return new Uint8Array(memory.buffer, ptr, source.length).slice()
  } finally {
    free(ptr, source.length)
  }
}

test('WASM reproduz o golden de opacidade de preenchimento byte a byte', () => {
  const corpus = JSON.parse(readFileSync(new URL('../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  const fixture = corpus.rasterCases.find((item) => item.id === 'fill-opacity-rounding')
  assert.ok(fixture)
  assert.deepEqual([...rustFillOpacity(new Uint8Array(fixture.source.rgba), fixture.styles.fillOpacity)], fixture.expected.rgba)
})

test('WASM e TS concordam para todos os alfas e opacidades inteiras', () => {
  const rgba = new Uint8ClampedArray(256 * 4)
  for (let alpha = 0; alpha < 256; alpha++) {
    rgba[alpha * 4] = (alpha * 17) % 256
    rgba[alpha * 4 + 1] = (alpha * 31) % 256
    rgba[alpha * 4 + 2] = (alpha * 47) % 256
    rgba[alpha * 4 + 3] = alpha
  }
  for (let opacity = 0; opacity <= 100; opacity++) {
    const ts = composeLayerStyleRaster(
      { width: 256, height: 1, data: rgba },
      normalizeLayerStyleConfig({ enabled: true, fillOpacity: opacity, effects: [] }),
      light
    )
    const rust = rustFillOpacity(rgba, opacity)
    assert.deepEqual([...rust], [...ts.data], `opacidade ${opacity}`)
  }
})

test('tiles Rust remontados concordam byte a byte com o raster TS integral', () => {
  const width = 7
  const height = 5
  const source = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < width * height; index++) {
    source.set([(index * 17) % 256, (index * 31) % 256,
      (index * 47) % 256, (index * 19) % 256], index * 4)
  }
  for (const opacity of [0, 1, 37, 50, 100]) {
    const expected = composeLayerStyleRaster(
      { width, height, data: source },
      normalizeLayerStyleConfig({ enabled: true, fillOpacity: opacity, effects: [] }),
      light
    )
    const assembled = new Uint8Array(source.length)
    for (let y = 0; y < height; y += 2) {
      for (let x = 0; x < width; x += 3) {
        const region = { x, y, width: Math.min(3, width - x), height: Math.min(2, height - y) }
        const tile = rustRegion(source, width, height, region, opacity)
        for (let row = 0; row < region.height; row++) {
          assembled.set(tile.subarray(row * region.width * 4, (row + 1) * region.width * 4),
            ((y + row) * width + x) * 4)
        }
      }
    }
    assert.deepEqual([...assembled], [...expected.data], `opacidade ${opacity}`)
  }
})

test('WASM rejeita tile fora dos limites e buffers sobrepostos sem escrever', () => {
  const sourcePtr = alloc(8)
  const outputPtr = alloc(4)
  assert.ok(sourcePtr > 0 && outputPtr > 0)
  try {
    new Uint8Array(memory.buffer, outputPtr, 4).fill(99)
    assert.equal(applyRegion(sourcePtr, 8, 2, 1, 2, 0, 1, 1, outputPtr, 4, 50), 4)
    assert.deepEqual([...new Uint8Array(memory.buffer, outputPtr, 4)], [99, 99, 99, 99])
    assert.equal(applyRegion(sourcePtr, 8, 2, 1, 0, 0, 1, 1, sourcePtr, 4, 50), 5)
    assert.equal(applyRegion(sourcePtr, 8, 2, 1, 0, 0, 1, 1, outputPtr, 3, 50), 1)
  } finally {
    free(outputPtr, 4)
    free(sourcePtr, 8)
  }
})

test('WASM rejeita comprimento e opacidade inválidos', () => {
  const ptr = alloc(4)
  assert.ok(ptr > 0)
  try {
    assert.equal(apply(ptr, 3, 50), 1)
    assert.equal(apply(ptr, 4, 101), 2)
    assert.equal(apply(0, 4, 50), 3)
  } finally {
    free(ptr, 4)
  }
})
