import type { ImageAsset, ImportedImage, LayerItem } from '../types/editor'

const supportedTypes = new Set(['image/png', 'image/jpeg', 'image/gif'])

async function readImageDimensions(source: string, file?: File) {
  if (file && 'createImageBitmap' in window) {
    const bitmap = await createImageBitmap(file)
    const dimensions = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return dimensions
  }

  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('O arquivo não contém uma imagem válida.'))
    image.src = source
  })
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Não foi possível preparar a prévia da imagem.'))
    image.src = source
  })
}

function canvasBlob(canvas: HTMLCanvasElement, mimeType: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível gerar a prévia da imagem.'))),
      mimeType,
      quality
    )
  })
}

export function imagePreviewSize(asset: Pick<ImageAsset, 'width' | 'height'>, width: number, height: number) {
  return {
    width: Math.max(1, Math.min(asset.width, Math.round(width))),
    height: Math.max(1, Math.min(asset.height, Math.round(height)))
  }
}

export function imagePreviewNeedsUpdate(asset: ImageAsset, width: number, height: number) {
  const target = imagePreviewSize(asset, width, height)
  if (!asset.previewUrl || !asset.previewWidth || !asset.previewHeight) return true

  const growing = target.width > asset.previewWidth * 1.25 || target.height > asset.previewHeight * 1.25
  const shrinking = target.width < asset.previewWidth * 0.65 || target.height < asset.previewHeight * 0.65
  return growing || shrinking
}

export async function createImagePreview(asset: ImageAsset, width: number, height: number) {
  const target = imagePreviewSize(asset, width, height)
  if (target.width === asset.width && target.height === asset.height) return undefined

  if (asset.sourceUrl.startsWith('/__axia_asset/')) {
    const query = new URLSearchParams({
      previewWidth: String(target.width),
      previewHeight: String(target.height)
    })
    return {
      url: `${asset.sourceUrl}?${query}`,
      width: target.width,
      height: target.height
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('O sistema não disponibilizou o renderizador de prévias.')

  let bitmap: ImageBitmap | undefined
  try {
    if ('createImageBitmap' in window) {
      const response = await fetch(asset.sourceUrl)
      if (!response.ok) throw new Error('Não foi possível carregar a imagem importada.')
      bitmap = await createImageBitmap(await response.blob(), {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: 'high'
      })
      context.drawImage(bitmap, 0, 0, target.width, target.height)
    } else {
      const image = await loadImage(asset.sourceUrl)
      context.drawImage(image, 0, 0, target.width, target.height)
    }

    const supportsTransparency = asset.mimeType !== 'image/jpeg'
    const blob = await canvasBlob(canvas, supportsTransparency ? 'image/webp' : 'image/jpeg', 0.9)
    return {
      url: URL.createObjectURL(blob),
      width: target.width,
      height: target.height
    }
  } finally {
    bitmap?.close()
    canvas.width = 1
    canvas.height = 1
  }
}

export async function readBrowserImages(files: FileList | File[]) {
  const images: ImportedImage[] = []
  const errors: string[] = []

  for (const file of Array.from(files)) {
    if (!supportedTypes.has(file.type)) {
      errors.push(`${file.name}: formato não suportado`)
      continue
    }

    const source = URL.createObjectURL(file)
    try {
      const dimensions = await readImageDimensions(source, file)
      images.push({
        id: crypto.randomUUID(),
        name: file.name,
        width: dimensions.width,
        height: dimensions.height,
        mimeType: file.type,
        sourceUrl: source
      })
    } catch (error) {
      URL.revokeObjectURL(source)
      errors.push(`${file.name}: ${error instanceof Error ? error.message : 'falha ao importar'}`)
    }
  }

  return { images, errors }
}

export function releaseLayerAssets(layers: LayerItem[]) {
  const released = new Set<string>()
  for (const layer of layers) {
    for (const source of [layer.image?.sourceUrl, layer.image?.previewUrl]) {
      if (source?.startsWith('blob:') && !released.has(source)) {
        URL.revokeObjectURL(source)
        released.add(source)
      }
    }
  }
}

export function releaseRemovedLayerAssets(layer: LayerItem, remainingLayers: LayerItem[]) {
  for (const source of [layer.image?.sourceUrl, layer.image?.previewUrl]) {
    if (!source?.startsWith('blob:')) continue
    const stillUsed = remainingLayers.some(
      (item) => item.image?.sourceUrl === source || item.image?.previewUrl === source
    )
    if (!stillUsed) URL.revokeObjectURL(source)
  }
}
