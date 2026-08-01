import type { ImportedImage, LayerItem } from '../types/editor'

const supportedTypes = new Set(['image/png', 'image/jpeg', 'image/gif'])

function readImageDimensions(source: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('O arquivo não contém uma imagem válida.'))
    image.src = source
  })
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
      const dimensions = await readImageDimensions(source)
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
  for (const layer of layers) {
    const source = layer.image?.sourceUrl
    if (source?.startsWith('blob:')) URL.revokeObjectURL(source)
  }
}
