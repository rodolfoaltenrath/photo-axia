export const MIN_ZOOM = 5
export const MAX_ZOOM = 3200

const ZOOM_LEVELS = [
  5, 6.25, 8.33, 12.5, 16.67, 25, 33.33, 50, 66.67, 100, 125, 150, 200, 300, 400, 600, 800,
  1200, 1600, 2400, 3200
]

export function clampZoom(value: number) {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100))
}

export function nextZoomLevel(current: number, direction: 1 | -1) {
  const epsilon = 0.01
  const level =
    direction > 0
      ? ZOOM_LEVELS.find((value) => value > current + epsilon)
      : [...ZOOM_LEVELS].reverse().find((value) => value < current - epsilon)

  return clampZoom(level ?? (direction > 0 ? MAX_ZOOM : MIN_ZOOM))
}

export function wheelZoomLevel(current: number, deltaY: number) {
  // Trackpads emit small deltas and wheels emit large ones. An exponential curve
  // keeps both inputs smooth without making zoom dependent on the frame rate.
  const normalizedDelta = Math.max(-240, Math.min(240, deltaY))
  return clampZoom(current * Math.exp(-normalizedDelta * 0.0025))
}

export function formatZoom(value: number) {
  return Number.isInteger(value) ? `${value}` : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}
