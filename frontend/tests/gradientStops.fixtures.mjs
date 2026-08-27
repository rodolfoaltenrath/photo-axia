const colorForIndex = (index, count) => {
  const channel = Math.round(index * 255 / Math.max(1, count - 1))
    .toString(16)
    .padStart(2, '0')
  return `#${channel}${channel}${channel}`
}

export function gradientStopsFixture(count) {
  return {
    type: 'linear',
    colorStops: Array.from({ length: count }, (_, index) => ({
      id: `color-${index + 1}`,
      position: index / Math.max(1, count - 1),
      color: colorForIndex(index, count)
    })),
    opacityStops: [
      { id: 'opacity-start', position: 0, opacity: 100 },
      { id: 'opacity-end', position: 1, opacity: 100 }
    ],
    reversed: false,
    interpolation: 'srgb'
  }
}

export const twoStopGradientFixture = gradientStopsFixture(2)
export const eightStopGradientFixture = gradientStopsFixture(8)
export const thirtyTwoStopGradientFixture = gradientStopsFixture(32)

export const threeStopTransparentGradientFixture = {
  type: 'linear',
  colorStops: [
    { id: 'red', position: 0, color: '#ff0000' },
    { id: 'green', position: 0.5, color: '#00ff00' },
    { id: 'blue', position: 1, color: '#0000ff' }
  ],
  opacityStops: [
    { id: 'opaque-start', position: 0, opacity: 100 },
    { id: 'transparent-center', position: 0.5, opacity: 0 },
    { id: 'opaque-end', position: 1, opacity: 100 }
  ],
  reversed: false,
  interpolation: 'srgb'
}
