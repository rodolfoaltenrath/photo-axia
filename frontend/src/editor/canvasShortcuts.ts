export type CanvasZoomShortcut =
  | { type: 'fit' }
  | { type: 'zoom'; value: number }
  | { type: 'step'; direction: 1 | -1 }

export function canvasZoomShortcut(code: string): CanvasZoomShortcut | undefined {
  switch (code) {
    case 'Digit0':
    case 'Numpad0':
      return { type: 'fit' }
    case 'Digit1':
    case 'Numpad1':
      return { type: 'zoom', value: 100 }
    case 'Digit2':
    case 'Numpad2':
      return { type: 'zoom', value: 200 }
    case 'Equal':
    case 'NumpadAdd':
      return { type: 'step', direction: 1 }
    case 'Minus':
    case 'NumpadSubtract':
      return { type: 'step', direction: -1 }
    default:
      return undefined
  }
}

export function canvasArrowNudgeDelta(key: string, shiftKey: boolean) {
  const step = shiftKey ? 10 : 1
  const movement: Record<string, { x: number; y: number }> = {
    ArrowUp: { x: 0, y: -step },
    ArrowDown: { x: 0, y: step },
    ArrowLeft: { x: -step, y: 0 },
    ArrowRight: { x: step, y: 0 }
  }
  return movement[key]
}

export function canvasPageScrollDelta(
  key: string,
  commandKey: boolean,
  viewport: { width: number; height: number }
) {
  if (key !== 'PageUp' && key !== 'PageDown') return undefined
  const direction = key === 'PageUp' ? -1 : 1
  return commandKey
    ? { left: direction * viewport.width * 0.9, top: 0 }
    : { left: 0, top: direction * viewport.height * 0.9 }
}
