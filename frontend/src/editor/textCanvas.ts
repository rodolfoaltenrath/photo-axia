import { layoutText, textFont } from './text.ts'
import type { TextLayerContent } from '../types/editor.ts'

const MAX_TEXT_STYLE_RASTER_DIMENSION = 16_384
const MAX_TEXT_STYLE_RASTER_PIXELS = 16_000_000

export interface TextStyleRasterPlan {
  drawScaleX: number
  drawScaleY: number
  effectScale: number
  height: number
  width: number
}

/** Plans the transient, high-density raster used only by layer styles. */
export function textStyleRasterPlan(
  text: Pick<TextLayerContent, 'baseWidth' | 'baseHeight'>,
  display: { width: number; height: number },
  preferredScale = 1
): TextStyleRasterPlan {
  const displayWidth = Number.isFinite(display.width) && display.width > 0 ? display.width : text.baseWidth
  const displayHeight = Number.isFinite(display.height) && display.height > 0 ? display.height : text.baseHeight
  const baseWidth = Math.max(1, text.baseWidth)
  const baseHeight = Math.max(1, text.baseHeight)
  const requestedScale = Number.isFinite(preferredScale) && preferredScale > 0 ? preferredScale : 1
  const maximumScale = Math.min(
    MAX_TEXT_STYLE_RASTER_DIMENSION / Math.max(1, displayWidth),
    MAX_TEXT_STYLE_RASTER_DIMENSION / Math.max(1, displayHeight),
    Math.sqrt(MAX_TEXT_STYLE_RASTER_PIXELS / Math.max(1, displayWidth * displayHeight))
  )
  const effectScale = Math.max(0.01, Math.min(requestedScale, maximumScale))
  const width = Math.max(1, Math.min(MAX_TEXT_STYLE_RASTER_DIMENSION, Math.round(displayWidth * effectScale)))
  const height = Math.max(1, Math.min(MAX_TEXT_STYLE_RASTER_DIMENSION, Math.round(displayHeight * effectScale)))
  return { width, height, drawScaleX: width / baseWidth, drawScaleY: height / baseHeight, effectScale }
}

/** Desenha o conteúdo vetorial do texto em sua caixa local, sem estilos de camada. */
export function drawTextLayerContent(
  context: CanvasRenderingContext2D,
  text: TextLayerContent,
  scale: { x: number; y: number } = { x: 1, y: 1 }
) {
  context.save()
  context.scale(scale.x, scale.y)
  const layout = layoutText(text, context)
  context.fillStyle = text.color
  context.font = textFont(text)
  ;(context as unknown as { letterSpacing?: string }).letterSpacing = `${text.letterSpacing ?? 0}px`
  context.textAlign = 'left'
  context.textBaseline = 'top'
  for (const line of layout.lines) {
    const top = line.y + (layout.lineHeight - text.fontSize) / 2
    context.fillText(line.content, line.x, top)
    if (text.decoration === 'underline' || text.decoration === 'line-through') {
      const y = text.decoration === 'underline'
        ? top + text.fontSize * 0.92
        : top + text.fontSize * 0.52
      context.fillRect(line.x, y, line.width, Math.max(1, text.fontSize / 18))
    }
  }
  context.restore()
}

export function textLayerSourceIdentity(text: TextLayerContent) {
  return JSON.stringify({
    content: text.content,
    fontFamily: text.fontFamily,
    fontSize: text.fontSize,
    fontWeight: text.fontWeight,
    color: text.color,
    alignment: text.alignment,
    lineHeight: text.lineHeight,
    baseWidth: text.baseWidth,
    baseHeight: text.baseHeight,
    layoutMode: text.layoutMode,
    fontStyle: text.fontStyle,
    letterSpacing: text.letterSpacing,
    decoration: text.decoration,
    textTransform: text.textTransform
  })
}
