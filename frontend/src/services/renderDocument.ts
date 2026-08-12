import type { DocumentSpec, LayerItem } from '../types/editor'
import { textFont, textLines } from '../editor/text'
import { layerIntersectsDocument } from '../editor/renderBounds'
import { canvasBlendOperation } from '../editor/blendModes'

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
  usePreviewSources: boolean
) {
  const canvas = window.document.createElement('canvas')
  canvas.width = width
  canvas.height = height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')
  context.scale(width / document.width, height / document.height)

  const background = layers.find((layer) => layer.kind === 'background')
  if (background?.visible && document.background !== 'transparent') {
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
    if (layer.kind !== 'image' || !layer.image) return
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
