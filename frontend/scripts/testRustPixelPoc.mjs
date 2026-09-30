import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { composeLayerStyleRaster } from '../src/editor/layerStyleRaster.ts'
import { normalizeLayerStyleConfig } from '../src/editor/layerStyles.ts'

const wasmPath = new URL('../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url)
const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), {})
const { memory, axia_poc_alloc: alloc, axia_poc_free: free, axia_poc_fill_opacity: apply } = instance.exports
const light = { angle: 0, altitude: 30 }

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
