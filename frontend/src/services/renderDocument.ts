import type { DocumentSpec, LayerItem } from '../types/editor'
import { textFont, textLines } from '../editor/text'
import { layerDocumentBounds, layerIntersectsDocument, type DocumentBounds } from '../editor/renderBounds'
import { canvasBlendOperation } from '../editor/blendModes'
import { sampledPixelToHex } from '../editor/colorSampler'

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Não foi possível preparar uma camada para exportação.'))
    image.src = source
  })
}

async function renderDocumentCanvas(
  document: DocumentSpec,
  layers: LayerItem[],
  width: number,
  height: number,
  usePreviewSources: boolean,
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
    context.globalAlpha = background.opacity / 100
    context.fillStyle = document.background === 'black' ? '#000000' : '#ffffff'
    context.fillRect(0, 0, document.width, document.height)
    context.restore()
  }

  const orderedLayers = [...layers].reverse().filter((layer) =>
    layer.visible && layer.transform && layerIntersectsDocument(layer, document)
  )
  const sourcePromises = new Map<string, Promise<HTMLImageElement>>()
  const images = new Map<string, HTMLImageElement>()
  await Promise.all(orderedLayers.map(async (layer) => {
    if (!layer.image) return
    const source = usePreviewSources
      ? layer.image.previewUrl ?? layer.image.sourceUrl
      : layer.image.sourceUrl
    let promise = sourcePromises.get(source)
    if (!promise) {
      promise = loadImage(source)
      sourcePromises.set(source, promise)
    }
    images.set(layer.id, await promise)
  }))

  for (const layer of orderedLayers) {
    if (!layer.transform) continue

    const image = images.get(layer.id)
    if (!image && (layer.kind !== 'text' || !layer.text)) continue

    const centerX = layer.transform.x + layer.transform.width / 2
    const centerY = layer.transform.y + layer.transform.height / 2
    context.save()
    context.globalAlpha = layer.opacity / 100
    context.globalCompositeOperation = canvasBlendOperation(layer.blendMode)
    context.translate(centerX, centerY)
    context.rotate(((layer.transform.rotation ?? 0) * Math.PI) / 180)

    if (image) {
      context.drawImage(
        image,
        -layer.transform.width / 2,
        -layer.transform.height / 2,
        layer.transform.width,
        layer.transform.height
      )
    } else if (layer.text) {
      const text = layer.text
      const scaleX = layer.transform.width / text.baseWidth
      const scaleY = layer.transform.height / text.baseHeight
      const lineHeight = text.fontSize * text.lineHeight
      const textX = text.alignment === 'center' ? text.baseWidth / 2 : text.alignment === 'right' ? text.baseWidth : 0

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
}

export async function renderDocumentPNG(document: DocumentSpec, layers: LayerItem[]) {
  const canvas = await renderDocumentCanvas(document, layers, document.width, document.height, false)
  return canvas.toDataURL('image/png')
}

export async function sampleDocumentColor(document: DocumentSpec, layers: LayerItem[], x: number, y: number) {
  const pixelX = Math.floor(x)
  const pixelY = Math.floor(y)
  if (pixelX < 0 || pixelY < 0 || pixelX >= document.width || pixelY >= document.height) return null

  const viewport = { x: pixelX, y: pixelY, width: 1, height: 1 }
  const canvas = await renderDocumentCanvas(document, layers, 1, 1, false, viewport)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('O sistema não disponibilizou a leitura de cores.')
  return sampledPixelToHex(context.getImageData(0, 0, 1, 1).data)
}

function canvasBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality))
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
  const canvas = await renderDocumentCanvas(document, layers, width, height, true)
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
    const bounds = layerDocumentBounds(layer)
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
  const canvas = await renderDocumentCanvas(document, layers, viewport.width, viewport.height, false, viewport)
  const blob = await canvasBlob(canvas, 'image/png')
  if (!blob) throw new Error('Não foi possível gerar os pixels da mesclagem.')
  return { blob, ...viewport }
}
