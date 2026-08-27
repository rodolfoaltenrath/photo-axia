import {
  createGradientInterpolator,
  normalizeGradientStopsConfig,
  type GradientConfigInput,
  type GradientGeometry
} from './gradient.ts'

export const DEFAULT_GRADIENT_PREVIEW_LUT_SIZE = 4096
export const MAXIMUM_GRADIENT_PREVIEW_LUT_SIZE = 65_536
export const MAXIMUM_INTERACTIVE_GRADIENT_PREVIEW_PIXELS = 262_144

export interface GradientPreviewLookup {
  pixels: Uint8ClampedArray
  size: number
}

export interface GradientPreviewRequest {
  width: number
  height: number
  documentWidth: number
  documentHeight: number
  geometry: GradientGeometry
  config: GradientConfigInput
  lookup?: GradientPreviewLookup
  output?: Uint8ClampedArray<ArrayBuffer>
}

export function createGradientPreviewLookup(
  config: GradientConfigInput,
  requestedSize = DEFAULT_GRADIENT_PREVIEW_LUT_SIZE
): GradientPreviewLookup {
  const size = Math.min(
    MAXIMUM_GRADIENT_PREVIEW_LUT_SIZE,
    Math.max(2, Number.isFinite(requestedSize) ? Math.floor(requestedSize) : DEFAULT_GRADIENT_PREVIEW_LUT_SIZE)
  )
  const interpolate = createGradientInterpolator(config)
  const pixels = new Uint8ClampedArray(size * 4)
  for (let index = 0; index < size; index++) {
    const offset = index * 4
    interpolate.write(pixels, offset, index / (size - 1))
  }
  return { pixels, size }
}

export function renderGradientPreviewPixels(request: GradientPreviewRequest): Uint8ClampedArray<ArrayBuffer> {
  const width = Math.max(1, Math.floor(request.width))
  const height = Math.max(1, Math.floor(request.height))
  const expectedLength = width * height * 4
  const pixels = request.output?.length === expectedLength
    ? request.output
    : new Uint8ClampedArray(expectedLength)
  const config = normalizeGradientStopsConfig(request.config)
  const lookup = request.lookup ?? createGradientPreviewLookup(config)
  const deltaX = request.geometry.end.x - request.geometry.start.x
  const deltaY = request.geometry.end.y - request.geometry.start.y
  const divisor = config.type === 'radial'
    ? Math.sqrt(deltaX * deltaX + deltaY * deltaY)
    : deltaX * deltaX + deltaY * deltaY
  const validDivisor = Number.isFinite(divisor) && divisor > Number.EPSILON
  const documentStepX = request.documentWidth / width
  const documentStepY = request.documentHeight / height

  const lookupMaximumIndex = lookup.size - 1
  let outputOffset = 0
  for (let y = 0; y < height; y++) {
    const pointY = (y + 0.5) * documentStepY - request.geometry.start.y
    let pointX = documentStepX * 0.5 - request.geometry.start.x
    let rawProgress = validDivisor && config.type === 'linear'
      ? (pointX * deltaX + pointY * deltaY) / divisor
      : 0
    const progressStep = validDivisor && config.type === 'linear'
      ? documentStepX * deltaX / divisor
      : 0
    for (let x = 0; x < width; x++, outputOffset += 4) {
      if (validDivisor && config.type === 'radial') {
        rawProgress = Math.sqrt(pointX * pointX + pointY * pointY) / divisor
      }
      const progress = Math.min(1, Math.max(0, rawProgress))
      const lookupOffset = Math.round(progress * lookupMaximumIndex) * 4
      pixels[outputOffset] = lookup.pixels[lookupOffset]!
      pixels[outputOffset + 1] = lookup.pixels[lookupOffset + 1]!
      pixels[outputOffset + 2] = lookup.pixels[lookupOffset + 2]!
      pixels[outputOffset + 3] = lookup.pixels[lookupOffset + 3]!
      pointX += documentStepX
      rawProgress += progressStep
    }
  }
  return pixels
}
