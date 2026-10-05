import type { TextLayerContent } from '../types/editor'

export type TextCanvasContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

/** Limita layouts abusivos no DOM e no Canvas. */
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
  textTransform: 'none',
  pathMode: 'none',
  pathOffset: 0
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

export interface EllipseTextPathGeometry {
  centerX: number
  centerY: number
  radiusX: number
  radiusY: number
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

/** Projetos antigos não possuem trajetória e continuam como texto linear. */
export function textPathMode(text: Pick<TextLayerContent, 'pathMode'>) {
  return text.pathMode === 'ellipse' ? 'ellipse' : 'none'
}

export function textPathOffset(text: Pick<TextLayerContent, 'pathOffset'>) {
  const offset = text.pathOffset
  return typeof offset === 'number' && Number.isFinite(offset)
    ? Math.min(360, Math.max(-360, offset))
    : 0
}

/** Afasta a linha-base das bordas para manter os glifos na caixa local. */
export function ellipseTextPathGeometry(text: Pick<TextLayerContent, 'baseWidth' | 'baseHeight' | 'fontSize'>): EllipseTextPathGeometry {
  const width = Math.max(1, text.baseWidth)
  const height = Math.max(1, text.baseHeight)
  const inset = Math.min(Math.max(1, text.fontSize * 1.1), Math.max(1, Math.min(width, height) / 2 - 1))
  return {
    centerX: width / 2,
    centerY: height / 2,
    radiusX: Math.max(1, width / 2 - inset),
    radiusY: Math.max(1, height / 2 - inset)
  }
}

/** SVG inicia no topo e avança no sentido horário, igual ao desenhador Canvas. */
export function ellipseTextPathData(text: Pick<TextLayerContent, 'baseWidth' | 'baseHeight' | 'fontSize'>) {
  const { centerX, centerY, radiusX, radiusY } = ellipseTextPathGeometry(text)
  const top = centerY - radiusY
  const bottom = centerY + radiusY
  return `M ${centerX} ${top} A ${radiusX} ${radiusY} 0 1 1 ${centerX} ${bottom} A ${radiusX} ${radiusY} 0 1 1 ${centerX} ${top}`
}

export function textDisplayContent(text: Pick<TextLayerContent, 'content' | 'textTransform'>) {
  return text.textTransform === 'uppercase' ? text.content.toLocaleUpperCase() : text.content
}

/** Uma trajetória é contínua; quebras explícitas viram espaço sem alterar o conteúdo salvo. */
export function textPathDisplayContent(text: Pick<TextLayerContent, 'content' | 'textTransform'>) {
  return textDisplayContent(text).replace(/\s*[\r\n]+\s*/gu, ' ')
}

export function textFont(text: Pick<TextLayerContent, 'fontFamily' | 'fontSize' | 'fontWeight' | 'fontStyle'>) {
  return `${text.fontStyle === 'italic' ? 'italic ' : ''}${text.fontWeight} ${text.fontSize}px ${text.fontFamily}`
}

function textWidth(context: TextCanvasContext | null | undefined, line: string, text: TextLayerContent) {
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

function wrappedTextLines(text: TextLayerContent, context: TextCanvasContext | null) {
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

export function layoutText(text: TextLayerContent, suppliedContext?: TextCanvasContext | null): TextLayout {
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

export function layoutTextLines(text: TextLayerContent, context?: TextCanvasContext | null) {
  return layoutText(text, context).lines.map((line) => line.content)
}

export function measureTextLayer(text: TextLayerContent) {
  if (textPathMode(text) === 'ellipse') {
    return {
      width: Math.max(1, Math.ceil(text.baseWidth)),
      height: Math.max(1, Math.ceil(text.baseHeight))
    }
  }
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
