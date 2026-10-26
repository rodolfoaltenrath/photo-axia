import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime } from '../../src/editor/rustPixelPocRuntime.ts'
import { rasterParityAnyPrecision, rasterParityDifference, rasterParityWithin, rasterSourceEdges } from '../../src/editor/rustRasterParity.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
// Gravado no WebView2 real do executável Wails (scripts/recordWebView2Resampling.mjs).
const recorded = JSON.parse(readFileSync(new URL('../../tests/fixtures/webview2Resampling.v1.json', import.meta.url), 'utf8')) as {
  encoding: 'rgba-base64'; userAgent: string; width: number; height: number; backdrop: number[]; opacity: number
  matrices: number[][]; sources: number[][]
  cases: { sourceIndex: number; matrixIndex: number; mode: string; context: string; rgba: string }[]
}
if (recorded.encoding !== 'rgba-base64') throw new Error('Codificação de fixture desconhecida.')
const fixture = { ...recorded, cases: recorded.cases.map(item => ({ ...item, rgba: Uint8Array.from(Buffer.from(item.rgba, 'base64')) })) }

type Mode = 'normal' | 'multiply' | 'screen' | 'overlay' | 'darken' | 'lighten'
const precisions = ['raster-bilinear', 'raster-bilinear-precise'] as const

async function compose(runtime: Awaited<ReturnType<typeof createRustPixelPocRuntime>>, item: typeof fixture.cases[number],
  sampling: typeof precisions[number]) {
  const { width, height } = fixture
  return runtime.composeDocumentRegion({ documentWidth: width, documentHeight: height,
    region: { x: 0, y: 0, width, height }, resolutionScale: 1,
    outputGrid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layersBottomToTop: [
      { rgba: new Uint8Array(fixture.backdrop), width: 1, height: 1, x: 0, y: 0, visible: true, opacity: 100,
        blendMode: 'normal', sourceToDocument: [width, 0, 0, height, 0, 0] },
      { rgba: new Uint8Array(fixture.sources[item.sourceIndex]!), width: 2, height: 2, x: 0, y: 0, visible: true,
        opacity: fixture.opacity, blendMode: item.mode as Mode, sourceToDocument: fixture.matrices[item.matrixIndex] as never, sampling }
    ] }).rgba
}

test('kernel Rust casa estritamente com o Canvas do WebView2 real fora dos pixels de empate', async () => {
  assert.equal(fixture.cases.length, 576)
  const runtime = await createRustPixelPocRuntime(wasm)
  let maxAlpha = 0, maxColor = 0, ties = 0
  try {
    for (const item of fixture.cases) {
      const candidates = []
      for (const variant of precisions) candidates.push({ variant, rgba: await compose(runtime, item, variant) })
      const best = rasterParityAnyPrecision(item.rgba, candidates, fixture.width, fixture.height,
        [rasterSourceEdges(fixture.matrices[item.matrixIndex]!, 2, 2)])
      assert.ok(rasterParityWithin(best),
        `${item.context}/m${item.matrixIndex}/${item.mode}/s${item.sourceIndex}: ${best.alpha}/${best.color.toFixed(2)}`)
      maxAlpha = Math.max(maxAlpha, best.alpha); maxColor = Math.max(maxColor, best.color); ties += best.ignored
    }
  } finally { runtime.dispose() }
  assert.ok(maxAlpha <= 2 && maxColor <= 3)
  assert.ok(ties > 0, 'a gravação precisa exercitar pixels de empate')
})

test('sem a máscara de empate o WebView2 diverge: a exceção é necessária, não decorativa', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const tieCase = fixture.cases.find(item => item.matrixIndex === 2 && item.mode === 'multiply' && item.context === 'read-frequent-16')!
    const rgba = await compose(runtime, tieCase, 'raster-bilinear-precise')
    assert.ok(!rasterParityWithin(rasterParityDifference(tieCase.rgba, rgba, fixture.width, fixture.height)))
    assert.ok(rasterParityWithin(rasterParityDifference(tieCase.rgba, rgba, fixture.width, fixture.height,
      [rasterSourceEdges(fixture.matrices[2]!, 2, 2)])))
  } finally { runtime.dispose() }
})
