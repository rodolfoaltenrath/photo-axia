import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime } from '../../src/editor/rustPixelPocRuntime.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
type Matrix = [number, number, number, number, number, number]

/**
 * Referência independente da média de área, escrita a partir da definição: integral da fonte
 * (constante por texel, transparente fora dela) sobre o quadrado do pixel de saída, em espaço
 * premultiplicado, dividida pela área da pegada; depois a composição Normal sobre transparente.
 * Mesma ordem de operações em f64 que o núcleo, para permitir igualdade byte a byte.
 */
function areaReference(source: Uint8Array, width: number, height: number, matrix: Matrix, opacity: number,
  documentWidth: number, documentHeight: number, origin: [number, number], region: { x: number; y: number; width: number; height: number }) {
  const [a, b, c, d, tx, ty] = matrix, det = a * d - b * c
  const inverse = [d / det, -b / det, -c / det, a / det]
  const documentBox = [-origin[0], -origin[1], documentWidth - origin[0], documentHeight - origin[1]]
  const output = new Uint8Array(region.width * region.height * 4)
  for (let ry = 0; ry < region.height; ry++) for (let rx = 0; rx < region.width; rx++) {
    const px = region.x + rx, py = region.y + ry
    if (px < documentBox[0]! || py < documentBox[1]! || px + 1 > documentBox[2]! || py + 1 > documentBox[3]!) continue
    const corners = [[px, py], [px + 1, py + 1]].map(([cx, cy]) => {
      const dx = cx! / 1 + origin[0] - tx, dy = cy! / 1 + origin[1] - ty
      return [inverse[0]! * dx + inverse[2]! * dy, inverse[1]! * dx + inverse[3]! * dy]
    })
    const u0 = Math.min(corners[0]![0]!, corners[1]![0]!), u1 = Math.max(corners[0]![0]!, corners[1]![0]!)
    const v0 = Math.min(corners[0]![1]!, corners[1]![1]!), v1 = Math.max(corners[0]![1]!, corners[1]![1]!)
    const area = (u1 - u0) * (v1 - v0)
    const cu0 = Math.max(u0, 0), cu1 = Math.min(u1, width), cv0 = Math.max(v0, 0), cv1 = Math.min(v1, height)
    if (area <= 0 || cu0 >= cu1 || cv0 >= cv1) continue
    let alpha = 0
    const color = [0, 0, 0]
    for (let iy = Math.floor(cv0); iy < cv1; iy++) {
      const wy = Math.min(cv1, iy + 1) - Math.max(cv0, iy)
      for (let ix = Math.floor(cu0); ix < cu1; ix++) {
        const wx = Math.min(cu1, ix + 1) - Math.max(cu0, ix), offset = (iy * width + ix) * 4
        const contribution = source[offset + 3]! * (wx * wy)
        alpha += contribution
        for (let channel = 0; channel < 3; channel++) color[channel]! += source[offset + channel]! * contribution
      }
    }
    if (alpha === 0) continue
    for (let channel = 0; channel < 3; channel++) color[channel]! /= alpha
    // composite_pixel_values com modo Normal sobre fundo transparente.
    const sourceAlpha = alpha / area * (opacity / 100) / 255
    if (sourceAlpha <= 0) continue
    const outputAlpha = sourceAlpha + 0 - sourceAlpha * 0, index = (ry * region.width + rx) * 4
    for (let channel = 0; channel < 3; channel++) {
      const value = color[channel]! / 255
      const premultiplied = (1 - sourceAlpha) * 0 * 0 + (1 - 0) * value * sourceAlpha + sourceAlpha * 0 * value
      output[index + channel] = Math.floor(Math.min(Math.max(premultiplied / outputAlpha, 0), 1) * 255 + 0.5)
    }
    output[index + 3] = Math.floor(outputAlpha * 255 + 0.5)
    if (output[index + 3] === 0) output.fill(0, index, index + 4)
  }
  return output
}

function pseudoRandom(width: number, height: number, seed: number) {
  const bytes = new Uint8Array(width * height * 4)
  for (let i = 0; i < bytes.length; i++) bytes[i] = (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24
  for (let i = 3; i < bytes.length; i += 12) bytes[i] = 255
  for (let i = 7; i < bytes.length; i += 20) bytes[i] = 0
  return bytes
}

test('média de área do núcleo casa byte a byte com a referência independente', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  let cases = 0, inked = 0
  try {
    for (const [width, height, seed] of [[7, 5, 3], [16, 12, 11], [31, 9, 29]] as const) {
      const source = pseudoRandom(width, height, seed)
      for (const matrix of [
        [0.3, 0, 0, 0.45, 0.75, 1.5], [0.1, 0, 0, 0.1, 2, 1], [0, 0.4, -0.35, 0, 6.25, 0.5],
        [-0.25, 0, 0, 0.4, 5.5, 0.125], [0.5, 0, 0, 0.5, -1.25, -0.5], [1, 0, 0, 1, 0.5, 0.5],
        [0.999, 0, 0, 0.37, 0.3125, 2.75], [0, -0.2, 0.3, 0, 1.5, 6.5]
      ] as Matrix[]) for (const opacity of [100, 63.7]) for (const origin of [[0, 0], [2, -1]] as [number, number][]) {
        for (const region of [{ x: 0, y: 0, width: 9, height: 7 }, { x: 3, y: 2, width: 4, height: 3 }]) {
          const expected = areaReference(source, width, height, matrix, opacity, 9, 7, origin, region)
          const actual = runtime.composeDocumentRegion({ documentWidth: 9, documentHeight: 7, region, resolutionScale: 1,
            outputGrid: { scaleX: 1, scaleY: 1, originX: origin[0], originY: origin[1] }, layersBottomToTop: [
              { rgba: source, width, height, x: 0, y: 0, visible: true, opacity, blendMode: 'normal',
                sourceToDocument: matrix, sampling: 'raster-area' }] }).rgba
          assert.deepEqual([...actual], [...expected], `${width}x${height} ${matrix.join(',')} opacidade ${opacity} origem ${origin}`)
          cases++; for (let i = 3; i < expected.length; i += 4) if (expected[i]) inked++
        }
      }
    }
  } finally { runtime.dispose() }
  assert.equal(cases, 192)
  assert.ok(inked > 1000, `poucos pixels com tinta: ${inked}`)
})

test('área preserva campo uniforme e não deixa RGB de texel transparente vazar', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const flat = new Uint8Array(12 * 12 * 4).map((_, i) => [40, 120, 200, 255][i % 4]!)
    const uniform = runtime.composeDocumentRegion({ documentWidth: 4, documentHeight: 4, region: { x: 0, y: 0, width: 4, height: 4 },
      resolutionScale: 1, outputGrid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layersBottomToTop: [
        { rgba: flat, width: 12, height: 12, x: 0, y: 0, visible: true, opacity: 100, blendMode: 'normal',
          sourceToDocument: [1 / 3, 0, 0, 1 / 3, 0, 0], sampling: 'raster-area' }] }).rgba
    for (let i = 0; i < uniform.length; i += 4) assert.deepEqual([...uniform.slice(i, i + 4)], [40, 120, 200, 255])
    // Metade opaca azul, metade transparente com RGB vermelho escondido.
    const half = new Uint8Array([0, 0, 255, 255, 255, 0, 0, 0])
    const mixed = runtime.composeDocumentRegion({ documentWidth: 1, documentHeight: 1, region: { x: 0, y: 0, width: 1, height: 1 },
      resolutionScale: 1, outputGrid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layersBottomToTop: [
        { rgba: half, width: 2, height: 1, x: 0, y: 0, visible: true, opacity: 100, blendMode: 'normal',
          sourceToDocument: [0.5, 0, 0, 1, 0, 0], sampling: 'raster-area' }] }).rgba
    assert.deepEqual([...mixed], [0, 0, 255, 128])
  } finally { runtime.dispose() }
})
