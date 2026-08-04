import type { TextLayerContent } from '../types/editor'

export const DEFAULT_TEXT_LAYER: TextLayerContent = {
  content: 'Texto',
  fontFamily: 'Arial, sans-serif',
  fontSize: 48,
  fontWeight: 400,
  color: '#ffffff',
  alignment: 'left',
  lineHeight: 1.2,
  baseWidth: 120,
  baseHeight: 58
}

let measurementContext: CanvasRenderingContext2D | null | undefined

export function textLines(content: string) {
  return content.replace(/\r/g, '').split('\n')
}

export function textFont(text: Pick<TextLayerContent, 'fontFamily' | 'fontSize' | 'fontWeight'>) {
  return `${text.fontWeight} ${text.fontSize}px ${text.fontFamily}`
}

export function measureTextLayer(text: TextLayerContent) {
  if (measurementContext === undefined) {
    measurementContext = document.createElement('canvas').getContext('2d')
  }

  const lines = textLines(text.content)
  const lineHeight = text.fontSize * text.lineHeight
  const context = measurementContext
  if (context) context.font = textFont(text)

  const measuredWidth = context
    ? Math.max(...lines.map((line) => context.measureText(line || ' ').width))
    : Math.max(...lines.map((line) => line.length * text.fontSize * 0.6))

  return {
    width: Math.max(1, Math.ceil(measuredWidth + 2)),
    height: Math.max(1, Math.ceil(lines.length * lineHeight))
  }
}
