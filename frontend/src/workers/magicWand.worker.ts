import { magicWandSpans } from '../editor/selection'

interface WandRequest {
  id: number
  blob: Blob
  x: number
  y: number
  tolerance: number
  contiguous: boolean
}

self.onmessage = async (event: MessageEvent<WandRequest>) => {
  const request = event.data
  try {
    const bitmap = await createImageBitmap(request.blob)
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('O sistema não disponibilizou leitura de pixels.')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    const image = context.getImageData(0, 0, canvas.width, canvas.height)
    const result = magicWandSpans(
      image.data,
      image.width,
      image.height,
      request.x,
      request.y,
      request.tolerance,
      request.contiguous
    )
    self.postMessage({ id: request.id, result })
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : 'Não foi possível calcular a seleção.'
    })
  }
}
