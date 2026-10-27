import type { RustDocumentOutputGrid, RustDocumentRasterLayer } from './rustDocumentComposite.ts'

type Sampling = NonNullable<RustDocumentRasterLayer['sampling']>

/**
 * Menor escala por eixo dos modos bilineares. Abaixo dela o bilinear deixa de tocar todos os
 * texels e gera aliasing; a redução passa à média de área. Espelha RASTER_BILINEAR_MIN_SCALE
 * do sampler Rust.
 */
export const RASTER_BILINEAR_MIN_SCALE = 0.5

/** Escalas por eixo de uma matriz alinhada a eixos ou em quarto de volta; `null` para o resto. */
export function rustRasterAxisScales(matrix: readonly number[]) {
  if (matrix.length !== 6) return null
  for (let index = 0; index < 6; index++) if (!Number.isFinite(matrix[index])) return null
  const [a, b, c, d] = matrix.map(value => Math.abs(value) <= 1e-12 ? 0 : value) as [number, number, number, number]
  if (b === 0 && c === 0 && a !== 0 && d !== 0) return { x: Math.abs(a), y: Math.abs(d) }
  if (a === 0 && d === 0 && b !== 0 && c !== 0) return { x: Math.abs(b), y: Math.abs(c) }
  return null
}

function integerGrid(grid: RustDocumentOutputGrid) {
  return !!grid && grid.scaleX === 1 && grid.scaleY === 1 && Number.isSafeInteger(grid.originX) && Number.isSafeInteger(grid.originY)
}

export function rustRasterSamplingSupported(matrix: readonly number[], grid: RustDocumentOutputGrid, sampling: Sampling) {
  const scales = rustRasterAxisScales(matrix)
  if (!scales || !integerGrid(grid)) return false
  return sampling === 'raster-area'
    ? scales.x <= 1 && scales.y <= 1
    : scales.x >= RASTER_BILINEAR_MIN_SCALE && scales.y >= RASTER_BILINEAR_MIN_SCALE
}

export function rustRasterBilinearSupported(matrix: readonly number[], grid: RustDocumentOutputGrid) {
  return rustRasterSamplingSupported(matrix, grid, 'raster-bilinear')
}

export function rustRasterBilinearMode(matrix: readonly number[], blendMode: RustDocumentRasterLayer['blendMode']): Sampling {
  return blendMode === 'normal' && Math.abs(matrix[1]!) <= 1e-12 && Math.abs(matrix[2]!) <= 1e-12 ?
    'raster-bilinear' : 'raster-bilinear-precise'
}

/**
 * Modo de amostragem para uma fonte raster reamostrada, ou `undefined` quando nenhum modo
 * representa a transformação (rotação arbitrária, cisalhamento, redução forte num eixo
 * combinada com ampliação no outro).
 */
export function rustRasterSamplingMode(matrix: readonly number[], grid: RustDocumentOutputGrid,
  blendMode: RustDocumentRasterLayer['blendMode']): Sampling | undefined {
  const scales = rustRasterAxisScales(matrix)
  if (!scales || !integerGrid(grid)) return undefined
  if (scales.x >= RASTER_BILINEAR_MIN_SCALE && scales.y >= RASTER_BILINEAR_MIN_SCALE) return rustRasterBilinearMode(matrix, blendMode)
  return rustRasterSamplingSupported(matrix, grid, 'raster-area') ? 'raster-area' : undefined
}

/** Modos cuja paridade com o Canvas depende da sonda de plataforma; a área é convenção do Rust. */
export function rustRasterSamplingNeedsPlatformProbe(sampling: RustDocumentRasterLayer['sampling']) {
  return sampling === 'raster-bilinear' || sampling === 'raster-bilinear-precise'
}

/**
 * Rotação arbitrária sem cisalhamento, com as duas escalas ≥ 0,5: o modo de cobertura do Rust
 * (bilinear no centro do pixel e cobertura geométrica exata na borda) atende. No interior ele casa
 * com o Canvas dentro de 2/3; na borda o Skia aproxima a cobertura e o Rust a calcula exata.
 * Convenção do Rust, sem sonda de plataforma. Redução abaixo de 0,5 com rotação ainda não tem modo.
 */
export function rustRotationCoverageSupported(matrix: readonly number[], grid: RustDocumentOutputGrid) {
  if (matrix.length !== 6 || !matrix.every(Number.isFinite) || !integerGrid(grid) || rustRasterAxisScales(matrix)) return false
  const [a, b, c, d] = matrix as [number, number, number, number], scaleX = Math.hypot(a, b), scaleY = Math.hypot(c, d)
  return Math.abs(a * c + b * d) <= 1e-9 * scaleX * scaleY &&
    scaleX >= RASTER_BILINEAR_MIN_SCALE && scaleY >= RASTER_BILINEAR_MIN_SCALE
}
