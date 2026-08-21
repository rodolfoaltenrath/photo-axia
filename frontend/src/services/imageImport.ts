import type { ImageAsset, ImportedImage, LayerItem } from '../types/editor'

const supportedTypes = new Set(['image/png', 'image/jpeg', 'image/gif'])
const MAX_EDITOR_PREVIEW_PIXELS = 4_194_304
const PREVIEW_SIZE_QUANTUM = 64
const IMAGE_HEADER_BYTES = 256 * 1024
const MAX_PREPARED_IMAGES = 24
const MAX_PREPARED_IMAGE_BYTES = 128 * 1024 * 1024
let previewWorker: Worker | undefined
let previewRequestId = 0
const previewRequests = new Map<number, {
  resolve: (blob: Blob) => void
  reject: (error: Error) => void
  signal?: AbortSignal
  abort?: () => void
}>()
interface PreparedImage {
  image: HTMLImageElement
  ready: Promise<HTMLImageElement>
  byteSize: number
}

const preparedImages = new Map<string, PreparedImage>()
let preparedImageBytes = 0

function deletePreparedImage(source: string) {
  const prepared = preparedImages.get(source)
  if (!prepared) return false
  preparedImages.delete(source)
  preparedImageBytes = Math.max(0, preparedImageBytes - prepared.byteSize)
  return true
}

function trimPreparedImages() {
  while (preparedImages.size > MAX_PREPARED_IMAGES || preparedImageBytes > MAX_PREPARED_IMAGE_BYTES) {
    const oldest = preparedImages.keys().next().value as string | undefined
    if (!oldest) break
    deletePreparedImage(oldest)
  }
}

export function clearPreparedImageCache() {
  preparedImages.clear()
  preparedImageBytes = 0
}

function uint16(view: DataView, offset: number, littleEndian = false) {
  return offset + 2 <= view.byteLength ? view.getUint16(offset, littleEndian) : 0
}

function readExifOrientation(view: DataView, segmentStart: number, segmentLength: number): number | undefined {
  const payloadStart = segmentStart + 2
  const payloadLength = segmentLength - 2
  if (payloadLength < 8 || payloadStart + 8 > view.byteLength) return undefined
  if (view.getUint32(payloadStart) !== 0x45786966 || view.getUint16(payloadStart + 4) !== 0x0000) return undefined

  const tiffStart = payloadStart + 6
  const byteOrderMark = uint16(view, tiffStart)
  if (byteOrderMark !== 0x4949 && byteOrderMark !== 0x4d4d) return undefined
  const littleEndian = byteOrderMark === 0x4949
  if (uint16(view, tiffStart + 2, littleEndian) !== 0x002a) return undefined

  const ifd0Offset = tiffStart + view.getUint32(tiffStart + 4, littleEndian)
  if (ifd0Offset + 2 > view.byteLength) return undefined
  const entryCount = uint16(view, ifd0Offset, littleEndian)
  for (let index = 0; index < entryCount; index++) {
    const entryOffset = ifd0Offset + 2 + index * 12
    if (entryOffset + 12 > view.byteLength) break
    if (uint16(view, entryOffset, littleEndian) === 0x0112) {
      return uint16(view, entryOffset + 8, littleEndian)
    }
  }
  return undefined
}

export function imageDimensionsFromHeader(buffer: ArrayBuffer, mimeType: string) {
  const view = new DataView(buffer)
  if (
    mimeType === 'image/png' && view.byteLength >= 24 &&
    view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a
  ) {
    return { width: view.getUint32(16), height: view.getUint32(20) }
  }
  if (
    mimeType === 'image/gif' && view.byteLength >= 10 &&
    view.getUint32(0) === 0x47494638
  ) {
    return { width: uint16(view, 6, true), height: uint16(view, 8, true) }
  }
  if (mimeType !== 'image/jpeg' || view.byteLength < 4 || uint16(view, 0) !== 0xffd8) return undefined

  const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf])
  let orientation = 1
  let offset = 2
  while (offset + 8 < view.byteLength) {
    while (offset < view.byteLength && view.getUint8(offset) !== 0xff) offset++
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset++
    if (offset >= view.byteLength) break
    const marker = view.getUint8(offset++)
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue
    const length = uint16(view, offset)
    if (length < 2 || offset + length > view.byteLength) break
    if (marker === 0xe1) {
      orientation = readExifOrientation(view, offset, length) ?? orientation
    } else if (frameMarkers.has(marker)) {
      const width = uint16(view, offset + 5)
      const height = uint16(view, offset + 3)
      // EXIF orientations 5-8 apply a 90°/270° rotation, which is what browsers
      // honor when painting the <img> — the raw SOF dimensions must be swapped
      // to match, or the fitted layer box ends up with the wrong aspect ratio.
      return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height }
    }
    offset += length
  }
  return undefined
}

async function readImageDimensions(source: string, file?: File) {
  if (file) {
    const header = await file.slice(0, IMAGE_HEADER_BYTES).arrayBuffer()
    const dimensions = imageDimensionsFromHeader(header, file.type)
    if (dimensions?.width && dimensions.height) return dimensions
  }

  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.onerror = () => reject(new Error('O arquivo não contém uma imagem válida.'))
    image.src = source
  })
}

function imagePreviewWorker() {
  if (previewWorker) return previewWorker
  const worker = new Worker(new URL('../workers/imagePreview.worker.ts', import.meta.url), { type: 'module' })
  worker.onmessage = (event: MessageEvent<{ id: number; blob?: Blob; error?: string }>) => {
    const request = previewRequests.get(event.data.id)
    if (!request) return
    previewRequests.delete(event.data.id)
    if (request.signal && request.abort) request.signal.removeEventListener('abort', request.abort)
    if (event.data.blob) request.resolve(event.data.blob)
    else request.reject(new Error(event.data.error ?? 'Não foi possível gerar a prévia da imagem.'))
  }
  worker.onerror = () => {
    for (const request of previewRequests.values()) {
      if (request.signal && request.abort) request.signal.removeEventListener('abort', request.abort)
      request.reject(new Error('O processador de prévias falhou.'))
    }
    previewRequests.clear()
    worker.terminate()
    previewWorker = undefined
  }
  previewWorker = worker
  return worker
}

function createPreviewBlobInWorker(
  source: Blob,
  width: number,
  height: number,
  mimeType: string,
  signal?: AbortSignal
) {
  return new Promise<Blob>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Prévia cancelada.', 'AbortError'))
      return
    }
    const id = ++previewRequestId
    const abort = () => {
      previewRequests.delete(id)
      imagePreviewWorker().postMessage({ cancel: id })
      reject(new DOMException('Prévia cancelada.', 'AbortError'))
    }
    signal?.addEventListener('abort', abort, { once: true })
    previewRequests.set(id, { resolve, reject, signal, abort })
    imagePreviewWorker().postMessage({ id, source, width, height, mimeType })
  })
}

export function disposeImagePreviewWorker() {
  previewWorker?.terminate()
  previewWorker = undefined
  for (const request of previewRequests.values()) {
    if (request.signal && request.abort) request.signal.removeEventListener('abort', request.abort)
    request.reject(new Error('Processamento de prévias encerrado.'))
  }
  previewRequests.clear()
  clearPreparedImageCache()
}

function loadImage(source: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Não foi possível preparar a prévia da imagem.'))
    image.src = source
  })
}

function waitForPreparedImage(ready: Promise<HTMLImageElement>, signal: AbortSignal) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const abort = () => reject(new DOMException('Carregamento cancelado.', 'AbortError'))
    const settle = (callback: () => void) => {
      signal.removeEventListener('abort', abort)
      callback()
    }
    signal.addEventListener('abort', abort, { once: true })
    ready.then(
      (image) => settle(() => resolve(image)),
      (error) => settle(() => reject(error))
    )
  })
}

export async function prepareImageSource(source: string, signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('Carregamento cancelado.', 'AbortError')
  let prepared = preparedImages.get(source)
  if (!prepared) {
    const image = new Image()
    image.decoding = 'async'
    let entry: PreparedImage
    const ready = new Promise<HTMLImageElement>((resolve, reject) => {
      image.onload = async () => {
        try {
          await image.decode()
        } catch {
          if (!image.complete || image.naturalWidth === 0) {
            reject(new Error('Não foi possível decodificar a prévia.'))
            return
          }
        }
        if (preparedImages.get(source) === entry) {
          entry.byteSize = Math.max(0, image.naturalWidth * image.naturalHeight * 4)
          preparedImageBytes += entry.byteSize
          trimPreparedImages()
        }
        resolve(image)
      }
      image.onerror = () => reject(new Error('Não foi possível carregar a prévia.'))
      image.src = source
    }).catch((error) => {
      if (preparedImages.get(source) === entry) deletePreparedImage(source)
      throw error
    })
    entry = { image, ready, byteSize: 0 }
    prepared = entry
    preparedImages.set(source, prepared)
    trimPreparedImages()
  } else {
    preparedImages.delete(source)
    preparedImages.set(source, prepared)
  }

  return signal ? waitForPreparedImage(prepared.ready, signal) : prepared.ready
}

export function releasePreparedImage(source: string) {
  deletePreparedImage(source)
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

export function editorPreviewSize(
  asset: Pick<ImageAsset, 'width' | 'height'>,
  width: number,
  height: number,
  viewportScale: number,
  pixelRatio: number,
  maximumPixels = MAX_EDITOR_PREVIEW_PIXELS
) {
  const density = Math.max(1, Math.min(2, pixelRatio || 1))
  const scale = Math.max(0.01, Math.abs(viewportScale)) * density
  const quantize = (value: number, maximum: number) => Math.max(
    1,
    Math.min(maximum, Math.ceil(value / PREVIEW_SIZE_QUANTUM) * PREVIEW_SIZE_QUANTUM)
  )
  let targetWidth = quantize(Math.abs(width) * scale, asset.width)
  let targetHeight = quantize(Math.abs(height) * scale, asset.height)
  const pixels = targetWidth * targetHeight
  if (pixels > maximumPixels) {
    const reduction = Math.sqrt(maximumPixels / pixels)
    targetWidth = Math.max(1, Math.min(asset.width, Math.floor(targetWidth * reduction)))
    targetHeight = Math.max(1, Math.min(asset.height, Math.floor(targetHeight * reduction)))
  }
  return { width: targetWidth, height: targetHeight }
}

export function imagePreviewNeedsUpdate(asset: ImageAsset, width: number, height: number) {
  const target = imagePreviewSize(asset, width, height)
  if (!asset.previewUrl || !asset.previewWidth || !asset.previewHeight) return true

  const growing = target.width > asset.previewWidth * 1.25 || target.height > asset.previewHeight * 1.25
  const shrinking = target.width < asset.previewWidth * 0.65 || target.height < asset.previewHeight * 0.65
  return growing || shrinking
}

export async function createImagePreview(
  asset: ImageAsset,
  width: number,
  height: number,
  signal?: AbortSignal
) {
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

  let sourceBlob: Blob | undefined
  if ('createImageBitmap' in window) {
    const response = await fetch(asset.sourceUrl, { signal })
    if (!response.ok) throw new Error('Não foi possível carregar a imagem importada.')
    sourceBlob = await response.blob()
    if (typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined') {
      const supportsTransparency = asset.mimeType !== 'image/jpeg'
      const blob = await createPreviewBlobInWorker(
        sourceBlob,
        target.width,
        target.height,
        supportsTransparency ? 'image/webp' : 'image/jpeg',
        signal
      )
      return { url: URL.createObjectURL(blob), width: target.width, height: target.height }
    }
  }

  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const context = canvas.getContext('2d', { alpha: true })
  if (!context) throw new Error('O sistema não disponibilizou o renderizador de prévias.')
  let bitmap: ImageBitmap | undefined
  try {
    if (sourceBlob) {
      bitmap = await createImageBitmap(sourceBlob, {
        resizeWidth: target.width,
        resizeHeight: target.height,
        resizeQuality: 'high'
      })
      context.drawImage(bitmap, 0, 0, target.width, target.height)
    } else {
      const image = await loadImage(asset.sourceUrl)
      if (signal?.aborted) throw new DOMException('Prévia cancelada.', 'AbortError')
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
  const entries = Array.from(files)
  const images = new Array<ImportedImage | undefined>(entries.length)
  const errors: string[] = []
  let nextIndex = 0

  async function readNext() {
    while (nextIndex < entries.length) {
      const index = nextIndex++
      const file = entries[index]!
      if (!supportedTypes.has(file.type)) {
        errors.push(`${file.name}: formato não suportado`)
        continue
      }
      const source = URL.createObjectURL(file)
      try {
        const dimensions = await readImageDimensions(source, file)
        images[index] = {
          id: crypto.randomUUID(),
          name: file.name,
          width: dimensions.width,
          height: dimensions.height,
          mimeType: file.type,
          sourceUrl: source
        }
      } catch (error) {
        URL.revokeObjectURL(source)
        errors.push(`${file.name}: ${error instanceof Error ? error.message : 'falha ao importar'}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(4, entries.length) }, () => readNext()))

  return { images: images.filter((image): image is ImportedImage => Boolean(image)), errors }
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
