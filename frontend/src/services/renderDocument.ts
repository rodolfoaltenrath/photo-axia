import type { DocumentSpec, LayerItem, LayerTransform, SmartLayerContent } from '../types/editor.ts'
import { canvasBlendOperation } from '../editor/blendModes.ts'
import { sampledDocumentPixel, sampledPixelToHex } from '../editor/colorSampler.ts'
import {
  layerStyledDocumentBounds,
  styledLayerIntersectsBounds,
  type DocumentBounds
} from '../editor/renderBounds.ts'
import {
  activeLayerStyleEffects,
  layerStyleNeedsCompositing,
  type LayerStyleRenderQuality
} from '../editor/layerStyleCompositor.ts'
import { layerStyleFillOpacity } from '../editor/layerStyles.ts'
import { textFont, textLines } from '../editor/text.ts'
import { sourceScaleFactor } from '../editor/selection.ts'
import { prepareImageSource } from './imageImport.ts'
import {
  acquireDecodedLayerStyle,
  releaseLayerStyleRenderConsumer,
  renderLayerStyle
} from './layerStyleCompositor.ts'

interface PreparedLayerRaster {
  image: CanvasImageSource
  sourceWidth: number
  sourceHeight: number
  renderedWidth: number
  renderedHeight: number
  offsetX: number
  offsetY: number
  dispose?: () => void
}

export interface LayerRasterGeometry {
  sourceWidth: number
  sourceHeight: number
  renderedWidth: number
  renderedHeight: number
  offsetX: number
  offsetY: number
}

export type LayerAppearanceMode = 'local' | 'isolated-export'

export interface LayerAppearanceRenderPlan {
  layer: LayerItem
  viewport: DocumentBounds
}

export interface RenderedLayerAppearance extends DocumentBounds {
  blob: Blob
}

let renderSessionId = 0

export function layerRasterDrawRect(transform: LayerTransform, raster: LayerRasterGeometry) {
  const scaleX = transform.width / raster.sourceWidth
  const scaleY = transform.height / raster.sourceHeight
  return {
    x: -transform.width / 2 + raster.offsetX * scaleX,
    y: -transform.height / 2 + raster.offsetY * scaleY,
    width: raster.renderedWidth * scaleX,
    height: raster.renderedHeight * scaleY
  }
}

export function layerAppearanceRenderPlan(
  document: Pick<DocumentSpec, 'width' | 'height' | 'background' | 'layerStyleGlobalLight'>,
  layer: LayerItem,
  mode: LayerAppearanceMode
): LayerAppearanceRenderPlan | null {
  const syntheticBackground = layer.kind === 'background' && !layer.image && document.background !== 'transparent'
  if (!syntheticBackground && (!layer.transform || (!layer.image && !layer.text))) return null

  const bounds = syntheticBackground
    ? { x: 0, y: 0, width: document.width, height: document.height }
    : layerStyledDocumentBounds(layer, document.layerStyleGlobalLight)
  if (!bounds) return null

  const left = Math.floor(bounds.x)
  const top = Math.floor(bounds.y)
  const right = Math.ceil(bounds.x + bounds.width)
  const bottom = Math.ceil(bounds.y + bounds.height)
  if (right <= left || bottom <= top) return null

  return {
    layer: {
      ...layer,
      visible: true,
      opacity: mode === 'local' ? 100 : layer.opacity,
      blendMode: 'normal'
    },
    viewport: { x: left, y: top, width: right - left, height: bottom - top }
  }
}

function assertSupportedLayerStyles(layers: LayerItem[]) {
  const unsupported = layers.flatMap((layer) => activeLayerStyleEffects(layer.styles)
    .filter((effect) => !layer.image || effect.type !== 'outer-glow')
    .map((effect) => effect.type))
  if (unsupported.length) {
    throw new Error(`Efeitos ainda nao suportados pelo compositor: ${[...new Set(unsupported)].join(', ')}.`)
  }
}

async function fetchImageBlob(source: string) {
  const response = await fetch(source)
  if (!response.ok) throw new Error('Não foi possível carregar a camada para composição.')
  return response.blob()
}

async function prepareLayerRaster(
  document: DocumentSpec,
  layer: LayerItem,
  usePreviewSource: boolean,
  consumerId: string,
  quality: LayerStyleRenderQuality
): Promise<PreparedLayerRaster> {
  const asset = layer.image
  if (!asset) throw new Error('A camada não possui raster para composição.')
  const preview = usePreviewSource && Boolean(asset.previewUrl)
  const source = preview ? asset.previewUrl! : asset.sourceUrl
  const sourceWidth = preview ? asset.previewWidth ?? asset.width : asset.width
  const sourceHeight = preview ? asset.previewHeight ?? asset.height : asset.height

  if (!layerStyleNeedsCompositing(layer.styles)) {
    return {
      image: await prepareImageSource(source),
      sourceWidth,
      sourceHeight,
      renderedWidth: sourceWidth,
      renderedHeight: sourceHeight,
      offsetX: 0,
      offsetY: 0
    }
  }

  const result = await renderLayerStyle({
    consumerId,
    layerId: layer.id,
    sourceIdentity: `${source}|${asset.editToken ?? ''}`,
    source: () => fetchImageBlob(source),
    sourceWidth,
    sourceHeight,
    styles: layer.styles,
    globalLight: document.layerStyleGlobalLight,
    resolutionScale: layer.transform
      ? 1 / sourceScaleFactor(layer.transform, sourceWidth, sourceHeight)
      : 1,
    quality
  })
  const decoded = await acquireDecodedLayerStyle(result)
  return {
    image: decoded.image,
    dispose: decoded.release,
    sourceWidth,
    sourceHeight,
    renderedWidth: result.width,
    renderedHeight: result.height,
    offsetX: result.offsetX,
    offsetY: result.offsetY
  }
}

async function renderDocumentCanvas(
  document: DocumentSpec,
  layers: LayerItem[],
  width: number,
  height: number,
  usePreviewSources: boolean,
  purpose: 'export' | 'layer' | 'merge' | 'sample' | 'smart' | 'thumbnail',
  viewport: DocumentBounds = { x: 0, y: 0, width: document.width, height: document.height }
) {
  const canvas = window.document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')
  context.scale(width / viewport.width, height / viewport.height)
  context.translate(-viewport.x, -viewport.y)

  const background = layers.find((layer) => layer.kind === 'background')
  if (background?.visible && !background.image && document.background !== 'transparent') {
    context.save()
    context.globalAlpha = (background.opacity / 100) * layerStyleFillOpacity(background.styles)
    context.fillStyle = document.background === 'black' ? '#000000' : '#ffffff'
    context.fillRect(0, 0, document.width, document.height)
    context.restore()
  }

  const orderedLayers = [...layers].reverse().filter((layer) =>
    layer.visible && layer.transform && styledLayerIntersectsBounds(layer, viewport, document.layerStyleGlobalLight)
  )
  assertSupportedLayerStyles([
    ...(background?.visible && !background.image ? [background] : []),
    ...orderedLayers
  ])
  const rasters = new Map<string, PreparedLayerRaster>()
  const session = `${purpose}:${document.id}:${++renderSessionId}`
  const consumers: string[] = []

  try {
    const prepared = await Promise.allSettled(orderedLayers.map(async (layer) => {
      if (!layer.image) return
      const consumerId = `${session}:${layer.id}`
      consumers.push(consumerId)
      rasters.set(layer.id, await prepareLayerRaster(
        document,
        layer,
        usePreviewSources,
        consumerId,
        usePreviewSources ? 'interactive' : 'final'
      ))
    }))
    const failed = prepared.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed) throw failed.reason

    for (const layer of orderedLayers) {
      if (!layer.transform) continue

      const raster = rasters.get(layer.id)
      if (!raster && (layer.kind !== 'text' || !layer.text)) continue

      const centerX = layer.transform.x + layer.transform.width / 2
      const centerY = layer.transform.y + layer.transform.height / 2
      context.save()
      context.globalAlpha = layer.opacity / 100
      context.globalCompositeOperation = canvasBlendOperation(layer.blendMode)
      context.translate(centerX, centerY)
      context.rotate(((layer.transform.rotation ?? 0) * Math.PI) / 180)

      if (raster) {
        const rect = layerRasterDrawRect(layer.transform, raster)
        context.drawImage(raster.image, rect.x, rect.y, rect.width, rect.height)
      } else if (layer.text) {
        const text = layer.text
        const scaleX = layer.transform.width / text.baseWidth
        const scaleY = layer.transform.height / text.baseHeight
        const lineHeight = text.fontSize * text.lineHeight
        const textX = text.alignment === 'center' ? text.baseWidth / 2 : text.alignment === 'right' ? text.baseWidth : 0

        context.globalAlpha *= layerStyleFillOpacity(layer.styles)
        context.scale(scaleX, scaleY)
        context.translate(-text.baseWidth / 2, -text.baseHeight / 2)
        context.beginPath()
        context.rect(0, 0, text.baseWidth, text.baseHeight)
        context.clip()
        context.fillStyle = text.color
        context.font = textFont(text)
        context.textAlign = text.alignment
        context.textBaseline = 'top'
        for (const [index, line] of textLines(text.content).entries()) {
          context.fillText(line, textX, index * lineHeight + (lineHeight - text.fontSize) / 2)
        }
      }

      context.restore()
    }

    return canvas
  } finally {
    for (const raster of rasters.values()) raster.dispose?.()
    for (const consumer of consumers) releaseLayerStyleRenderConsumer(consumer)
  }
}

export async function renderDocumentPNG(document: DocumentSpec, layers: LayerItem[]) {
  const canvas = await renderDocumentCanvas(document, layers, document.width, document.height, false, 'export')
  return canvas.toDataURL('image/png')
}

export async function renderDocumentBlob(document: DocumentSpec, layers: LayerItem[]) {
  const canvas = await renderDocumentCanvas(document, layers, document.width, document.height, false, 'export')
  const blob = await canvasBlob(canvas, 'image/png')
  if (!blob) throw new Error('Não foi possível gerar os pixels do documento.')
  return blob
}

export async function renderSmartLayerContentBlob(
  content: SmartLayerContent,
  layers: LayerItem[],
  width: number,
  height: number,
  interactive = false
) {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0 ||
    width > 16_384 || height > 16_384 || width * height > 64_000_000
  ) throw new Error('A resolução solicitada para a camada inteligente é inválida.')
  const document: DocumentSpec = {
    id: content.id,
    name: 'Conteúdo inteligente',
    width: content.width,
    height: content.height,
    unit: 'px',
    physicalWidth: content.width,
    physicalHeight: content.height,
    resolutionDpi: content.resolutionDpi,
    colorSpace: content.colorSpace,
    background: content.background,
    createdAt: '',
    layerStyleGlobalLight: content.layerStyleGlobalLight
  }
  const canvas = await renderDocumentCanvas(
    document,
    layers,
    width,
    height,
    interactive,
    'smart',
    { x: 0, y: 0, width: content.width, height: content.height }
  )
  const blob = await canvasBlob(canvas, 'image/png')
  if (!blob) throw new Error('Não foi possível renderizar o conteúdo inteligente.')
  return blob
}

export async function sampleDocumentColor(document: DocumentSpec, layers: LayerItem[], x: number, y: number) {
  const pixel = sampledDocumentPixel(x, y, document.width, document.height)
  if (!pixel) return null

  const viewport = { ...pixel, width: 1, height: 1 }
  const canvas = await renderDocumentCanvas(document, layers, 1, 1, false, 'sample', viewport)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('O sistema não disponibilizou a leitura de cores.')
  return sampledPixelToHex(context.getImageData(0, 0, 1, 1).data)
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
}

export async function renderLayerAppearance(
  document: DocumentSpec,
  layer: LayerItem,
  mode: LayerAppearanceMode = 'local'
): Promise<RenderedLayerAppearance> {
  const plan = layerAppearanceRenderPlan(document, layer, mode)
  if (!plan) throw new Error('A camada não possui conteúdo visual para rasterizar.')
  const { viewport } = plan
  if (viewport.width > 16_384 || viewport.height > 16_384 || viewport.width * viewport.height > 64_000_000) {
    throw new Error('A aparência da camada excede o limite seguro de rasterização.')
  }
  const canvas = await renderDocumentCanvas(
    document,
    [plan.layer],
    viewport.width,
    viewport.height,
    false,
    'layer',
    viewport
  )
  const blob = await canvasBlob(canvas, 'image/png')
  if (!blob) throw new Error('Não foi possível gerar a aparência da camada.')
  return { blob, ...viewport }
}

export async function renderDocumentThumbnail(
  document: DocumentSpec,
  layers: LayerItem[],
  maximumWidth = 384,
  maximumHeight = 216
) {
  const scale = Math.min(maximumWidth / document.width, maximumHeight / document.height, 1)
  const width = Math.max(1, Math.round(document.width * scale))
  const height = Math.max(1, Math.round(document.height * scale))
  const canvas = await renderDocumentCanvas(document, layers, width, height, true, 'thumbnail')
  return (await canvasBlob(canvas, 'image/webp', 0.82)) ?? (await canvasBlob(canvas, 'image/png'))
}

export async function renderMergedLayers(document: DocumentSpec, layers: LayerItem[]) {
  const visibleLayers = layers.filter((layer) => layer.visible)
  if (!visibleLayers.length) throw new Error('Selecione ao menos uma camada visível para mesclar.')

  const hasSyntheticBackground = visibleLayers.some((layer) =>
    layer.kind === 'background' && !layer.image && document.background !== 'transparent'
  )
  let left = hasSyntheticBackground ? 0 : document.width
  let top = hasSyntheticBackground ? 0 : document.height
  let right = hasSyntheticBackground ? document.width : 0
  let bottom = hasSyntheticBackground ? document.height : 0
  let hasBounds = hasSyntheticBackground

  for (const layer of visibleLayers) {
    if (!layer.image && !layer.text) continue
    const bounds = layerStyledDocumentBounds(layer, document.layerStyleGlobalLight)
    if (!bounds) continue
    hasBounds = true
    left = Math.min(left, bounds.x)
    top = Math.min(top, bounds.y)
    right = Math.max(right, bounds.x + bounds.width)
    bottom = Math.max(bottom, bounds.y + bounds.height)
  }
  if (!hasBounds) throw new Error('As camadas selecionadas não possuem pixels visíveis para mesclar.')

  left = Math.max(0, Math.floor(left))
  top = Math.max(0, Math.floor(top))
  right = Math.min(document.width, Math.ceil(right))
  bottom = Math.min(document.height, Math.ceil(bottom))
  if (right <= left || bottom <= top) throw new Error('As camadas selecionadas estão fora do documento.')

  const viewport = { x: left, y: top, width: right - left, height: bottom - top }
  const canvas = await renderDocumentCanvas(document, layers, viewport.width, viewport.height, false, 'merge', viewport)
  const blob = await canvasBlob(canvas, 'image/png')
  if (!blob) throw new Error('Não foi possível gerar os pixels da mesclagem.')
  return { blob, ...viewport }
}
