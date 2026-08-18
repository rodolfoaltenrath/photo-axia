export type ColorSampleTarget = 'foreground' | 'background'

export function colorSampleTarget(button: number): ColorSampleTarget | undefined {
  if (button === 0) return 'foreground'
  if (button === 2) return 'background'
  return undefined
}

export function colorSampleButtonIsPressed(target: ColorSampleTarget, buttons: number) {
  const mask = target === 'foreground' ? 1 : 2
  return (buttons & mask) === mask
}

export function sampledDocumentPixel(x: number, y: number, width: number, height: number) {
  if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  const pixel = { x: Math.floor(x), y: Math.floor(y) }
  return pixel.x >= 0 && pixel.y >= 0 && pixel.x < width && pixel.y < height ? pixel : null
}

export function sampledPixelToHex(pixel: ArrayLike<number>) {
  if (pixel.length < 4 || pixel[3] === 0) return null
  const channel = (index: number) => Math.max(0, Math.min(255, Math.round(pixel[index] ?? 0)))
    .toString(16)
    .padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}
