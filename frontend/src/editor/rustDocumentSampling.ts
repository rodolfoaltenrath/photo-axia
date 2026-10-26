import type { RustDocumentOutputGrid, RustDocumentRasterLayer } from './rustDocumentComposite.ts'

export function rustRasterBilinearSupported(matrix: readonly number[], grid: RustDocumentOutputGrid) {
  if (!grid || matrix.length !== 6) return false
  for (let index = 0; index < 6; index++) if (!Number.isFinite(matrix[index])) return false
  if (grid.scaleX !== 1 || grid.scaleY !== 1 || !Number.isSafeInteger(grid.originX) || !Number.isSafeInteger(grid.originY)) return false
  const [a, b, c, d] = matrix.map(value => Math.abs(value) <= 1e-12 ? 0 : value)
  return (b === 0 && c === 0 && Math.abs(a!) >= 1 && Math.abs(d!) >= 1) ||
    (a === 0 && d === 0 && Math.abs(b!) >= 1 && Math.abs(c!) >= 1)
}

export function rustRasterBilinearMode(matrix: readonly number[], blendMode: RustDocumentRasterLayer['blendMode']): NonNullable<RustDocumentRasterLayer['sampling']> {
  return blendMode === 'normal' && Math.abs(matrix[1]!) <= 1e-12 && Math.abs(matrix[2]!) <= 1e-12 ?
    'raster-bilinear' : 'raster-bilinear-precise'
}
