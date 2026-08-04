import type { DocumentSpec, LayerItem } from '../types/editor'
import { textFont, textLines } from '../editor/text'

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Não foi possível preparar uma camada para exportação.'))
    image.src = source
  })
}

export async function renderDocumentPNG(document: DocumentSpec, layers: LayerItem[]) {
  const canvas = window.document.createElement('canvas')
  canvas.width = document.width
  canvas.height = document.height

  const context = canvas.getContext('2d')
  if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')

  const background = layers.find((layer) => layer.kind === 'background')
  if (background?.visible && document.background !== 'transparent') {
    context.save()
    context.globalAlpha = background.opacity / 100
    context.fillStyle = document.background === 'black' ? '#000000' : '#ffffff'
    context.fillRect(0, 0, document.width, document.height)
    context.restore()
  }

  for (const layer of [...layers].reverse()) {
    if (!layer.visible || !layer.transform) continue

    const image = layer.kind === 'image' && layer.image ? await loadImage(layer.image.sourceUrl) : undefined
    if (!image && (layer.kind !== 'text' || !layer.text)) continue

    const centerX = layer.transform.x + layer.transform.width / 2
    const centerY = layer.transform.y + layer.transform.height / 2
    context.save()
    context.globalAlpha = layer.opacity / 100
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

  return canvas.toDataURL('image/png')
}
