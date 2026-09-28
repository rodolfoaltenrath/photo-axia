import type { TextLayerContent } from '../types/editor'

/** Texto Ã© renderizado no DOM e no Canvas; estes limites evitam layouts abusivos. */
export const MAX_TEXT_CONTENT_LENGTH = 20_000
export const MAX_TEXT_LINE_COUNT = 4_000
export const MAX_TEXT_FONT_FAMILY_LENGTH = 512

export const DEFAULT_TEXT_LAYER: TextLayerContent = {
  content: 'Texto',
  fontFamily: 'Arial, sans-serif',
  fontSize: 48,
  fontWeight: 400,
  color: '#ffffff',
  alignment: 'left',
  lineHeight: 1.2,
  baseWidth: 120,
  baseHeight: 58,
  layoutMode: 'point',
  fontStyle: 'normal',
  letterSpacing: 0,
  decoration: 'none',
  textTransform: 'none'
}

let measurementContext: CanvasRenderingContext2D | null | undefined

export interface TextLayoutLine {
  content: string
  width: number
  x: number
  y: number
}

export interface TextLayout {
  height: number
  lineHeight: number
  lines: TextLayoutLine[]
  width: number
}

export function textLines(content: string) {
  return content.replace(/\r/g, '').split('\n')
}

export function textContentIsWithinLimits(content: string) {
  return content.length <= MAX_TEXT_CONTENT_LENGTH && textLines(content).length <= MAX_TEXT_LINE_COUNT
}

/** Projetos antigos não gravavam o modo; seu comportamento era sempre pontual. */
export function textLayoutMode(text: Pick<TextLayerContent, 'layoutMode'>) {
  return text.layoutMode === 'paragraph' ? 'paragraph' : 'point'
}

export function textDisplayContent(text: Pick<TextLayerContent, 'content' | 'textTransform'>) {
  return text.textTransform === 'uppercase' ? text.content.toLocaleUpperCase() : text.content
}

export function textFont(text: Pick<TextLayerContent, 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle'>) {
  return `${text.fontStyle === 'italic' ? 'italic ' : ''}${text.fontWeight} ${text.fontSize}px ${text.fontFamily}`
}

function textWidth(context: CanvasRenderingContext2D | null | undefined, line: string, text: TextLayerContent) {
  const glyphWidth = context ? context.measureText(line || ' ').width : (line || ' ').length * text.fontSize * 0.6
  const tracking = Math.max(0, line.length - 1) * (text.letterSpacing ?? 0)
  return glyphWidth + tracking
}

/** Quebra previsível compartilhada entre preview, Canvas e exportação. */
function textMeasurementContext() {
  if (measurementContext === undefined) {
    measurementContext = typeof document === 'undefined'
      ? null
      : document.createElement('canvas').getContext('2d')
  }
  return measurementContext
}

function wrappedTextLines(text: TextLayerContent, context: CanvasRenderingContext2D | null) {
  const sourceLines = textLines(textDisplayContent(text))
  if (textLayoutMode(text) !== 'paragraph') return sourceLines
  const maxWidth = Math.max(1, text.baseWidth)
  const lines: string[] = []
  for (const source of sourceLines) {
    if (!source) {
      lines.push('')
      continue
    }
    let line = ''
    for (const token of source.split(/(\s+)/u).filter(Boolean)) {
      const candidate = `${line}${token}`
      if (line && textWidth(context, candidate, text) > maxWidth) {
        lines.push(line.trimEnd())
        line = token.trimStart()
      } else line = candidate
    }
    lines.push(line.trimEnd())
  }
  return lines.length ? lines : ['']
}

export function layoutText(text: TextLayerContent, suppliedContext?: CanvasRenderingContext2D | null): TextLayout {
  const context = suppliedContext === undefined ? textMeasurementContext() : suppliedContext
  if (context) context.font = textFont(text)
  const contentLines = wrappedTextLines(text, context)
  const lineHeight = text.fontSize * text.lineHeight
  const measuredWidth = Math.max(...contentLines.map((line) => textWidth(context, line, text)))
  const width = textLayoutMode(text) === 'paragraph'
    ? Math.max(1, Math.ceil(text.baseWidth))
    : Math.max(1, Math.ceil(measuredWidth + 2))
  const availableWidth = textLayoutMode(text) === 'paragraph' ? width : Math.max(width, text.baseWidth)
  const lines = contentLines.map((content, index) => {
    const lineWidth = textWidth(context, content, text)
    const x = text.alignment === 'center'
      ? (availableWidth - lineWidth) / 2
      : text.alignment === 'right'
        ? availableWidth - lineWidth
        : 0
    return { content, width: lineWidth, x, y: index * lineHeight }
  })
  return {
    lines,
    lineHeight,
    width,
    height: Math.max(1, Math.ceil(lines.length * lineHeight))
  }
}

export function layoutTextLines(text: TextLayerContent, context?: CanvasRenderingContext2D | null) {
  return layoutText(text, context).lines.map((line) => line.content)
}

export function measureTextLayer(text: TextLayerContent) {
  const layout = layoutText(text)
  return { width: layout.width, height: layout.height }
}

/** Produz a caixa de parágrafo refluída sem aplicar escala à tipografia. */
export function resizeParagraphText(text: TextLayerContent, baseWidth: number) {
  const next: TextLayerContent = {
    ...text,
    layoutMode: 'paragraph',
    baseWidth: Math.min(16_384, Math.max(1, Math.round(baseWidth)))
  }
  const size = measureTextLayer(next)
  next.baseWidth = size.width
  next.baseHeight = size.height
  return next
}
