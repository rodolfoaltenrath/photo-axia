import {
  ellipseTextPathGeometry,
  layoutText,
  textFont,
  textPathDisplayContent,
  textPathMode,
  textPathOffset
} from './text.ts'
import type { LayerStyleWorkerTextSource } from './layerStyleRenderProtocol.ts'
import type { TextLayerContent } from '../types/editor.ts'

const MAX_TEXT_STYLE_RASTER_DIMENSION = 16_384
const MAX_TEXT_STYLE_RASTER_PIXELS = 16_000_000
const TEXT_PRESENTATION_DENSITY_STEPS = [1, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32] as const
const ELLIPSE_ARC_SAMPLES = 360

export interface TextStyleRasterPlan {
  drawScaleX: number
  drawScaleY: number
  effectScale: number
  height: number
  width: number
}

export interface TextPresentationScale {
  horizontalCorrection: number
  renderScale: number
  scaleX: number
  scaleY: number
}

interface EllipseArcSample {
  angle: number
  distance: number
  x: number
  y: number
}

/**
 * MantÃ©m o texto DOM nÃ­tido quando a camada foi ampliada: a fonte passa a ser
 * desenhada na escala vertical final, e somente uma distorÃ§Ã£o nÃ£o uniforme
 * residual permanece em transform. Em escala uniforme, nÃ£o hÃ¡ scale no texto.
 */
export function textPresentationScale(
  text: Pick<TextLayerContent, 'baseWidth' | 'baseHeight'>,
  display: { width: number; height: number },
  viewportScale = 1
): TextPresentationScale {
  const displayWidth = Number.isFinite(display.width) && display.width > 0 ? display.width : text.baseWidth
  const displayHeight = Number.isFinite(display.height) && display.height > 0 ? display.height : text.baseHeight
  const scaleX = Math.max(0.0001, displayWidth / Math.max(1, text.baseWidth))
  const scaleY = Math.max(0.0001, displayHeight / Math.max(1, text.baseHeight))
  const requestedDensity = Math.max(1, Number.isFinite(viewportScale) ? viewportScale : 1)
  const steppedDensity = TEXT_PRESENTATION_DENSITY_STEPS.find((step) => step >= requestedDensity)
    ?? TEXT_PRESENTATION_DENSITY_STEPS[TEXT_PRESENTATION_DENSITY_STEPS.length - 1]!
  const maximumDensity = Math.min(
    MAX_TEXT_STYLE_RASTER_DIMENSION / Math.max(1, displayWidth),
    MAX_TEXT_STYLE_RASTER_DIMENSION / Math.max(1, displayHeight),
    Math.sqrt(MAX_TEXT_STYLE_RASTER_PIXELS / Math.max(1, displayWidth * displayHeight))
  )
  const renderScale = Math.max(1, Math.min(steppedDensity, maximumDensity))
  return { scaleX, scaleY, horizontalCorrection: scaleX / scaleY, renderScale }
}

export function textStyleRasterSource(
  text: TextLayerContent,
  plan: Pick<TextStyleRasterPlan, 'drawScaleX' | 'drawScaleY'>
): LayerStyleWorkerTextSource {
  return {
    type: 'text',
    // Vue pode envolver a camada em Proxy, que nÃ£o Ã© clonÃ¡vel para o Worker.
    text: { ...text },
    drawScaleX: plan.drawScaleX,
    drawScaleY: plan.drawScaleY
  }
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

function modulo(value: number, divisor: number) {
  const result = value % divisor
  return result < 0 ? result + divisor : result
}

function ellipseArcSamples(text: TextLayerContent) {
  const geometry = ellipseTextPathGeometry(text)
  const samples: EllipseArcSample[] = []
  let previous: EllipseArcSample | undefined
  let distance = 0
  for (let index = 0; index <= ELLIPSE_ARC_SAMPLES; index++) {
    const angle = -Math.PI / 2 + (index / ELLIPSE_ARC_SAMPLES) * Math.PI * 2
    const x = geometry.centerX + geometry.radiusX * Math.cos(angle)
    const y = geometry.centerY + geometry.radiusY * Math.sin(angle)
    if (previous) distance += Math.hypot(x - previous.x, y - previous.y)
    const sample = { angle, distance, x, y }
    samples.push(sample)
    previous = sample
  }
  return samples
}

function ellipsePointAtDistance(samples: EllipseArcSample[], requestedDistance: number) {
  const circumference = samples[samples.length - 1]?.distance ?? 0
  if (!circumference) return undefined
  const distance = modulo(requestedDistance, circumference)
  let index = 1
  while (index < samples.length && samples[index]!.distance < distance) index++
  const next = samples[Math.min(index, samples.length - 1)]!
  const previous = samples[Math.max(0, index - 1)]!
  const span = Math.max(Number.EPSILON, next.distance - previous.distance)
  const progress = (distance - previous.distance) / span
  const angle = previous.angle + (next.angle - previous.angle) * progress
  return {
    angle,
    x: previous.x + (next.x - previous.x) * progress,
    y: previous.y + (next.y - previous.y) * progress
  }
}

/** Desenha glifos individualmente para manter o mesmo caminho no Canvas, Worker e exportação. */
function drawTextOnEllipse(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  text: TextLayerContent
) {
  const content = textPathDisplayContent(text)
  if (!content) return
  const geometry = ellipseTextPathGeometry(text)
  const samples = ellipseArcSamples(text)
  const circumference = samples[samples.length - 1]?.distance ?? 0
  if (!circumference) return

  const graphemes = Array.from(content)
  const tracking = text.letterSpacing ?? 0
  const advances = graphemes.map((grapheme, index) => Math.max(0.1,
    context.measureText(grapheme).width + (index < graphemes.length - 1 ? tracking : 0)
  ))
  const totalWidth = advances.reduce((sum, advance) => sum + advance, 0)
  const alignmentOffset = text.alignment === 'center'
    ? -totalWidth / 2
    : text.alignment === 'right'
      ? -totalWidth
      : 0
  const start = circumference * textPathOffset(text) / 360 + alignmentOffset
  let cursor = 0

  for (let index = 0; index < graphemes.length; index++) {
    const advance = advances[index]!
    const point = ellipsePointAtDistance(samples, start + cursor + advance / 2)
    if (!point) break
    const tangent = Math.atan2(
      Math.cos(point.angle) * geometry.radiusY,
      -Math.sin(point.angle) * geometry.radiusX
    )
    context.save()
    context.translate(point.x, point.y)
    context.rotate(tangent)
    context.fillText(graphemes[index]!, -advance / 2, 0)
    if (text.decoration === 'underline' || text.decoration === 'line-through') {
      const decorationY = text.decoration === 'underline' ? text.fontSize * 0.12 : -text.fontSize * 0.3
      context.fillRect(-advance / 2, decorationY, advance, Math.max(1, text.fontSize / 18))
    }
    context.restore()
    cursor += advance
  }
}

/** Desenha o conteúdo vetorial do texto em sua caixa local, sem estilos de camada. */
export function drawTextLayerContent(
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
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
  context.textBaseline = textPathMode(text) === 'ellipse' ? 'alphabetic' : 'top'
  if (textPathMode(text) === 'ellipse') {
    drawTextOnEllipse(context, text)
    context.restore()
    return
  }
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
    textTransform: text.textTransform,
    pathMode: text.pathMode,
    pathOffset: text.pathOffset
  })
}
