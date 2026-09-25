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
  baseHeight: 58,
  layoutMode: 'point',
  fontStyle: 'normal',
  letterSpacing: 0,
  decoration: 'none',
  textTransform: 'none'
}

let measurementContext: CanvasRenderingContext2D | null | undefined

export function textLines(content: string) {
  return content.replace(/\r/g, '').split('\n')
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

/** Quebra previsível usada pelo Canvas; o DOM recebe as mesmas largura e regras de palavra. */
export function layoutTextLines(text: TextLayerContent, context = measurementContext) {
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

export function measureTextLayer(text: TextLayerContent) {
  if (measurementContext === undefined) {
    measurementContext = typeof document === 'undefined'
      ? null
      : document.createElement('canvas').getContext('2d')
  }

  const context = measurementContext
  if (context) context.font = textFont(text)
  const lines = layoutTextLines(text, context)
  const lineHeight = text.fontSize * text.lineHeight
  const measuredWidth = Math.max(...lines.map((line) => textWidth(context, line, text)))

  return {
    width: textLayoutMode(text) === 'paragraph'
      ? Math.max(1, Math.ceil(text.baseWidth))
      : Math.max(1, Math.ceil(measuredWidth + 2)),
    height: Math.max(1, Math.ceil(lines.length * lineHeight))
  }
}
