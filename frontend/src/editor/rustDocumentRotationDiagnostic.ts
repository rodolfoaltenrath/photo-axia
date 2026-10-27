import { createRustPixelPocRuntime } from './rustPixelPocRuntime.ts'
import { canvasBlendOperation } from './blendModes.ts'
import type { RustDocumentRasterLayer } from './rustDocumentComposite.ts'

type Matrix = NonNullable<RustDocumentRasterLayer['sourceToDocument']>
type Sampling = RustDocumentRasterLayer['sampling']
const modes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const

/** Matrizes com rotação arbitrária (ângulo, escalas, translação fracionária) para uma fonte 6×4. */
export function rustRotationMatrices(): Matrix[] {
  const result: Matrix[] = []
  for (const [degrees, scaleX, scaleY, tx, ty] of [
    [15, 1, 1, 9.25, 4.5], [30, 1.5, 1.5, 10, 3.75], [45, 1, 1, 11.5, 5.25], [73, 2, 1.25, 14.125, 2.5],
    [-22.5, 0.75, 0.75, 6.5, 8.25], [120, 1.25, 2, 18.75, 9.5], [200, 1, 1, 17.5, 15.25], [-61, 0.6, 1.8, 7.25, 10.75]
  ] as const) {
    const angle = degrees * Math.PI / 180, cos = Math.cos(angle), sin = Math.sin(angle)
    result.push([cos * scaleX, sin * scaleX, -sin * scaleY, cos * scaleY, tx, ty])
  }
  return result
}

/**
 * Classifica cada pixel de saída por cobertura do quadrilátero da fonte, com 8×8 subamostras:
 * 0 fora, 1 interior, 2 borda (o contorno da fonte cruza o pixel). Só a borda depende do
 * antisserrilhamento da plataforma; o interior é bilinear puro.
 */
export function rustRotationPixelClasses(matrix: Matrix, sourceWidth: number, sourceHeight: number, width: number, height: number) {
  const [a, b, c, d, tx, ty] = matrix, det = a * d - b * c
  const classes = new Uint8Array(width * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    let inside = 0
    for (let sy = 0; sy < 8; sy++) for (let sx = 0; sx < 8; sx++) {
      const px = x + (sx + 0.5) / 8 - tx, py = y + (sy + 0.5) / 8 - ty
      const u = (d * px - c * py) / det, v = (-b * px + a * py) / det
      if (u >= 0 && v >= 0 && u <= sourceWidth && v <= sourceHeight) inside++
    }
    classes[y * width + x] = inside === 0 ? 0 : inside === 64 ? 1 : 2
  }
  return classes
}

/** Diferença máxima entre duas saídas RGBA, separada por classe de pixel. */
export function rustRotationDifference(expected: ArrayLike<number>, actual: ArrayLike<number>, classes: Uint8Array) {
  const result = { interiorAlpha: 0, interiorColor: 0, edgeAlpha: 0, edgeColor: 0, outsideAlpha: 0, outsideColor: 0 }
  for (let pixel = 0; pixel < classes.length; pixel++) {
    const i = pixel * 4, alpha = Math.abs(expected[i + 3]! - actual[i + 3]!)
    let color = 0
    for (let channel = 0; channel < 3; channel++) color = Math.max(color,
      Math.abs(expected[i + channel]! * expected[i + 3]! / 255 - actual[i + channel]! * actual[i + 3]! / 255))
    const key = (['outside', 'interior', 'edge'] as const)[classes[pixel]!]!
    result[`${key}Alpha`] = Math.max(result[`${key}Alpha`], alpha)
    result[`${key}Color`] = Math.max(result[`${key}Color`], color)
  }
  return result
}

/** Rust contra `drawImage` do Canvas com rotação arbitrária, nos seis modos e três fontes. */
export async function runRustDocumentRotationDiagnostic(wasm: ArrayBuffer, sampling: Sampling = undefined) {
  const runtime = await createRustPixelPocRuntime(wasm), width = 28, height = 24, sourceWidth = 6, sourceHeight = 4
  const worst = { interiorAlpha: 0, interiorColor: 0, edgeAlpha: 0, edgeColor: 0, outsideAlpha: 0, outsideColor: 0 }
  const worstCase: Record<string, string> = {}
  let cases = 0
  const source = new OffscreenCanvas(sourceWidth, sourceHeight), bottom = new OffscreenCanvas(1, 1)
  const backdrop = new Uint8Array([20, 80, 160, 109])
  bottom.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(backdrop), 1, 1), 0, 0)
  const fixtures = [
    (index: number) => [index * 41 % 256, index * 97 % 256, index * 13 % 256, 255],
    (index: number) => [index * 41 % 256, index * 97 % 256, index * 13 % 256, [255, 128, 37, 0, 210][index % 5]!]
  ]
  try {
    for (const [sourceIndex, pixel] of fixtures.entries()) {
      const values = Array.from({ length: sourceWidth * sourceHeight }, (_, index) => pixel(index)).flat()
      const context = source.getContext('2d')!
      context.putImageData(new ImageData(new Uint8ClampedArray(values), sourceWidth, sourceHeight), 0, 0)
      const rgba = new Uint8Array(context.getImageData(0, 0, sourceWidth, sourceHeight).data)
      const image = new Image(), imageUrl = URL.createObjectURL(await source.convertToBlob({ type: 'image/png' }))
      try {
        image.src = imageUrl; await image.decode()
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
        try {
          const output = canvas.getContext('2d', { willReadFrequently: true })!
          for (const [matrixIndex, matrix] of rustRotationMatrices().entries()) for (const mode of modes) {
            output.resetTransform(); output.globalAlpha = 1; output.globalCompositeOperation = 'source-over'
            output.clearRect(0, 0, width, height); output.drawImage(bottom, 0, 0, width, height)
            output.globalAlpha = 0.637; output.globalCompositeOperation = canvasBlendOperation(mode)
            output.setTransform(...matrix)
            output.drawImage(image, 0, 0, sourceWidth, sourceHeight)
            const expected = output.getImageData(0, 0, width, height).data
            const actual = runtime.composeDocumentRegion({ documentWidth: width, documentHeight: height,
              region: { x: 0, y: 0, width, height }, resolutionScale: 1,
              outputGrid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layersBottomToTop: [
                { rgba: backdrop, width: 1, height: 1, x: 0, y: 0, visible: true, opacity: 100, blendMode: 'normal',
                  sourceToDocument: [width, 0, 0, height, 0, 0] },
                { rgba, width: sourceWidth, height: sourceHeight, x: 0, y: 0, visible: true, opacity: 63.7, blendMode: mode,
                  sourceToDocument: matrix, ...(sampling ? { sampling } : {}) }
              ] }).rgba
            const difference = rustRotationDifference(expected, actual,
              rustRotationPixelClasses(matrix, sourceWidth, sourceHeight, width, height))
            for (const key of Object.keys(worst) as (keyof typeof worst)[]) {
              if (difference[key] > worst[key]) { worst[key] = difference[key]; worstCase[key] = `${sourceIndex}/${matrixIndex}/${mode}` }
            }
            cases++
          }
        } finally { canvas.width = 1; canvas.height = 1 }
      } finally { URL.revokeObjectURL(imageUrl) }
    }
    // Interior: bilinear puro, mesma tolerância da reamostragem axial. Borda (e o anel logo fora dela):
    // o Skia aproxima a cobertura analítica e o Rust a calcula exata; medido 9/11,9 no Edge 156.
    if (worst.interiorAlpha > 2 || worst.interiorColor > 3) throw new Error(`Rotação no interior: ${JSON.stringify({ worst, worstCase })}`)
    if (Math.max(worst.edgeAlpha, worst.outsideAlpha) > 12 || Math.max(worst.edgeColor, worst.outsideColor) > 16) {
      throw new Error(`Rotação na borda: ${JSON.stringify({ worst, worstCase })}`)
    }
    return { cases, sampling: sampling ?? 'coverage-bilinear', worst, worstCase,
      interiorTolerance: [2, 3], edgeTolerance: [12, 16] }
  } finally { runtime.dispose(); source.width = 1; source.height = 1; bottom.width = 1; bottom.height = 1 }
}
