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

export function sampledPixelToHex(pixel: ArrayLike<number>) {
  if (pixel.length < 4 || pixel[3] === 0) return null
  const channel = (index: number) => Math.max(0, Math.min(255, Math.round(pixel[index] ?? 0)))
    .toString(16)
    .padStart(2, '0')
  return `#${channel(0)}${channel(1)}${channel(2)}`
}
