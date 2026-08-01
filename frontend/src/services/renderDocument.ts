import type { DocumentSpec, LayerItem } from '../types/editor'

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
    if (!layer.visible || layer.kind !== 'image' || !layer.image || !layer.transform) continue

    const image = await loadImage(layer.image.sourceUrl)
    context.save()
    context.globalAlpha = layer.opacity / 100
    context.drawImage(
      image,
      layer.transform.x,
      layer.transform.y,
      layer.transform.width,
      layer.transform.height
    )
    context.restore()
  }

  return canvas.toDataURL('image/png')
}
