import {
  normalizeGradientStopsConfig,
  type GradientStopsConfig,
  type GradientType
} from './gradient.ts'

export function createGradientToolConfig(
  foregroundColor: string,
  backgroundColor: string,
  type: GradientType = 'linear'
) {
  return normalizeGradientStopsConfig({
    type,
    foregroundColor,
    backgroundColor,
    reversed: false
  })
}

export function syncSimpleGradientColors(
  input: GradientStopsConfig,
  foregroundColor: string,
  backgroundColor: string
) {
  if (input.colorStops.length !== 2) return input
  return normalizeGradientStopsConfig({
    ...input,
    colorStops: input.colorStops.map((stop, index) => ({
      ...stop,
      color: index === 0 ? foregroundColor : backgroundColor
    }))
  })
}
