interface PreviewRequest {
  id: number
  source: Blob
  width: number
  height: number
  mimeType: string
}

let queue = Promise.resolve()
const cancelled = new Set<number>()

async function generatePreview(request: PreviewRequest) {
  if (cancelled.delete(request.id)) return
  const bitmap = await createImageBitmap(request.source, {
    imageOrientation: 'from-image',
    resizeWidth: request.width,
    resizeHeight: request.height,
    resizeQuality: 'high'
  })
  try {
    const canvas = new OffscreenCanvas(request.width, request.height)
    const context = canvas.getContext('2d', { alpha: true })
    if (!context) throw new Error('Renderizador de prévias indisponível.')
    context.drawImage(bitmap, 0, 0, request.width, request.height)
    const blob = await canvas.convertToBlob({
      type: request.mimeType,
      quality: request.mimeType === 'image/jpeg' ? 0.9 : undefined
    })
    if (!cancelled.delete(request.id)) self.postMessage({ id: request.id, blob })
  } finally {
    bitmap.close()
  }
}

self.onmessage = (event: MessageEvent<PreviewRequest | { cancel: number }>) => {
  if ('cancel' in event.data) {
    cancelled.add(event.data.cancel)
    return
  }
  const request = event.data
  queue = queue
    .then(() => generatePreview(request))
    .catch((error) => {
      self.postMessage({
        id: request.id,
        error: error instanceof Error ? error.message : 'Falha ao gerar prévia.'
      })
    })
}

export {}
