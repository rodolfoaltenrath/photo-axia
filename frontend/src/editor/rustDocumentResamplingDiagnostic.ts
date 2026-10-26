import { createRustPixelPocRuntime } from './rustPixelPocRuntime.ts'
import { canvasBlendOperation } from './blendModes.ts'
import type { RustDocumentRasterLayer } from './rustDocumentComposite.ts'
import { rasterParityAnyPrecision, rasterParityWithin, rasterSourceEdges } from './rustRasterParity.ts'

type Matrix = NonNullable<RustDocumentRasterLayer['sourceToDocument']>
const modes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const
const precisions = ['raster-bilinear', 'raster-bilinear-precise'] as const
const matrices: readonly Matrix[] = [
  [1, 0, 0, 1, 2, 2], [1, 0, 0, 1, 2.25, 2], [1, 0, 0, 1, 2.5, 2.25], [1, 0, 0, 1, 2.75, 2.5],
  [1, 0, 0, 1, -0.5, -0.25], [1, 0, 0, 1, -0.75, -0.5],
  [2, 0, 0, 2, 2, 2], [1.5, 0, 0, 1.5, 2, 2], [2, 0, 0, 2, 2.25, 2.5], [1.5, 0, 0, 1.5, 2.25, 2.5],
  [3.25, 0, 0, 1.5, 0.125, 1.375], [1.125, 0, 0, 2.25, 0.5, 0.75],
  [0, 1, -1, 0, 4.5, 2.25], [0, -1.5, 2, 0, 0.25, 4.5], [-1.5, 0, 0, 2, 5.25, 0.5], [-1, 0, 0, -1, 3.5, 2.75]
]

/**
 * Compara o kernel raster Rust com o Canvas da plataforma em 288 casos. Exige paridade estrita
 * fora dos pixels de empate, contra a precisão de peso que a plataforma escolheu (ver
 * rustRasterParity.ts). Não depende da direção de empate nem da precisão do Chromium em uso.
 */
export async function runRustDocumentResamplingDiagnostic(wasm: ArrayBuffer) {
  const runtime = await createRustPixelPocRuntime(wasm), width = 16, height = 12
  let cases = 0, maxAlphaDifference = 0, maxPremultipliedDifference = 0, tiePixels = 0
  const matched: Record<(typeof precisions)[number], number> = { 'raster-bilinear': 0, 'raster-bilinear-precise': 0 }
  const source = new OffscreenCanvas(2, 2), bottom = new OffscreenCanvas(1, 1)
  const backdrop = new Uint8Array([20, 80, 160, 109])
  bottom.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(backdrop), 1, 1), 0, 0)
  try {
    for (const [sourceIndex, values] of [
      [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255],
      [255, 0, 0, 255, 0, 255, 0, 109, 0, 0, 255, 0, 255, 255, 255, 128],
      [20, 96, 255, 109, 7, 237, 51, 1, 192, 80, 40, 255, 255, 200, 100, 128]
    ].entries()) {
      const context = source.getContext('2d')!
      context.putImageData(new ImageData(new Uint8ClampedArray(values), 2, 2), 0, 0)
      const rgba = new Uint8Array(context.getImageData(0, 0, 2, 2).data)
      const image = new Image(), imageUrl = URL.createObjectURL(await source.convertToBlob({ type: 'image/png' }))
      try {
        image.src = imageUrl; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
        try {
          const output = canvas.getContext('2d', { willReadFrequently: true })!
          for (const [matrixIndex, matrix] of matrices.entries()) for (const mode of modes) {
            output.resetTransform(); output.globalAlpha = 1; output.globalCompositeOperation = 'source-over'
            output.clearRect(0, 0, canvas.width, canvas.height); output.drawImage(bottom, 0, 0, width, height)
            output.globalAlpha = 0.637; output.globalCompositeOperation = canvasBlendOperation(mode)
            const [a, b, c, d, tx, ty] = matrix, sx = Math.hypot(a, b), sy = Math.hypot(c, d)
            output.setTransform(a / sx, b / sx, c / sy, d / sy, tx + a + c, ty + b + d)
            output.drawImage(image, -sx, -sy, 2 * sx, 2 * sy)
            const expected = output.getImageData(0, 0, width, height).data
            const candidates = precisions.map(variant => ({ variant, rgba: runtime.composeDocumentRegion({
              documentWidth: width, documentHeight: height,
              region: { x: 0, y: 0, width, height }, resolutionScale: 1,
              outputGrid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layersBottomToTop: [
                { rgba: backdrop, width: 1, height: 1, x: 0, y: 0, visible: true, opacity: 100, blendMode: 'normal', sourceToDocument: [width, 0, 0, height, 0, 0] },
                { rgba, width: 2, height: 2, x: 0, y: 0, visible: true, opacity: 63.7, blendMode: mode, sourceToDocument: matrix, sampling: variant }
              ] }).rgba }))
            const best = rasterParityAnyPrecision(expected, candidates, width, height, [rasterSourceEdges(matrix, 2, 2)])
            if (!rasterParityWithin(best)) {
              throw new Error(`Raster ${sourceIndex}/${matrixIndex}/${mode}: ${best.alpha}/${best.color}`)
            }
            matched[best.variant]++; tiePixels += best.ignored
            maxAlphaDifference = Math.max(maxAlphaDifference, best.alpha)
            maxPremultipliedDifference = Math.max(maxPremultipliedDifference, best.color); cases++
          }
        } finally { canvas.width = 1; canvas.height = 1 }
      } finally { URL.revokeObjectURL(imageUrl) }
    }
    return { cases, maxAlphaDifference, maxPremultipliedDifference, alphaTolerance: 2, premultipliedTolerance: 3,
      contexts: ['read-frequent-16'], tiePixels, matched }
  } finally { runtime.dispose(); source.width = 1; source.height = 1; bottom.width = 1; bottom.height = 1 }
}
