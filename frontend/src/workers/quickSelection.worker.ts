import {
  quickSelectionSpansCooperatively,
  type QuickSelectionOptions
} from '../editor/quickSelection'

interface QuickSelectionRequest {
  id: number
  blob: Blob
  sourceKey: string
  options: QuickSelectionOptions
}

interface QuickSelectionCancelRequest {
  cancel: number
}

const cancelledRequests = new Set<number>()
const activeRequests = new Set<number>()
let cachedImage: { sourceKey: string; data: Uint8ClampedArray; width: number; height: number } | undefined

function wasCancelled(id: number) {
  return cancelledRequests.has(id)
}

self.onmessage = async (event: MessageEvent<QuickSelectionRequest | QuickSelectionCancelRequest>) => {
  if ('cancel' in event.data) {
    if (activeRequests.has(event.data.cancel)) cancelledRequests.add(event.data.cancel)
    return
  }
  const request = event.data
  activeRequests.add(request.id)
  try {
    if (cachedImage?.sourceKey !== request.sourceKey) {
      const bitmap = await createImageBitmap(request.blob)
      if (wasCancelled(request.id)) {
        bitmap.close()
        return
      }
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
      const context = canvas.getContext('2d', { willReadFrequently: true })
      if (!context) throw new Error('O sistema não disponibilizou leitura de pixels.')
      context.drawImage(bitmap, 0, 0)
      bitmap.close()
      const image = context.getImageData(0, 0, canvas.width, canvas.height)
      canvas.width = 1
      canvas.height = 1
      cachedImage = { sourceKey: request.sourceKey, data: image.data, width: image.width, height: image.height }
    }
    const image = cachedImage
    if (!image) throw new Error('Não foi possível preparar os pixels da camada ativa.')
    const result = await quickSelectionSpansCooperatively(
      image.data,
      image.width,
      image.height,
      request.options,
      {
        throwIfCancelled: () => {
          if (wasCancelled(request.id)) throw new DOMException('Seleção cancelada.', 'AbortError')
        },
        yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0))
      }
    )
    if (!wasCancelled(request.id)) self.postMessage({ id: request.id, result })
  } catch (error) {
    if (!wasCancelled(request.id)) {
      self.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : 'Não foi possível calcular a Seleção Rápida.'
      })
    }
  } finally {
    activeRequests.delete(request.id)
    cancelledRequests.delete(request.id)
  }
}
