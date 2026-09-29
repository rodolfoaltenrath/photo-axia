import { composeLayerStyleRaster, type LayerStylePatternRasters } from '../editor/layerStyleRaster.ts'
import { drawTextLayerContent } from '../editor/textCanvas.ts'
import type {
  LayerStyleWorkerRenderRequest,
  LayerStyleWorkerRequest,
  LayerStyleWorkerResult
} from '../editor/layerStyleRenderProtocol.ts'

const cancelled = new Set<number>()
let queue = Promise.resolve()

function ensureCurrent(id: number) {
  if (!cancelled.has(id)) return
  cancelled.delete(id)
  throw new DOMException('Composição cancelada.', 'AbortError')
}

async function decodePatternBlob(blob: Blob) {
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  try {
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!context) throw new Error('Renderizador de estilos indisponível.')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height)
    return { width: pixels.width, height: pixels.height, data: pixels.data }
  } finally {
    bitmap.close()
    canvas.width = 1
    canvas.height = 1
  }
}

async function decodePatterns(patterns: Record<string, Blob>): Promise<LayerStylePatternRasters> {
  const entries = await Promise.all(
    Object.entries(patterns).map(async ([id, blob]) => [id, await decodePatternBlob(blob)] as const)
  )
  return new Map(entries)
}

async function render(request: LayerStyleWorkerRenderRequest) {
  ensureCurrent(request.id)
  const patterns = await decodePatterns(request.patterns)
  let bitmap: ImageBitmap | undefined
  let sourceCanvas: OffscreenCanvas | undefined
  let output: OffscreenCanvas | undefined
  try {
    ensureCurrent(request.id)
    sourceCanvas = new OffscreenCanvas(request.sourceWidth, request.sourceHeight)
    const sourceContext = sourceCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!sourceContext) throw new Error('Renderizador de estilos indisponível.')
    if (request.source.type === 'text') {
      drawTextLayerContent(sourceContext, request.source.text, {
        x: request.source.drawScaleX,
        y: request.source.drawScaleY
      })
    } else {
      bitmap = await createImageBitmap(request.source.blob, {
        resizeWidth: request.sourceWidth,
        resizeHeight: request.sourceHeight,
        resizeQuality: request.quality === 'interactive' ? 'medium' : 'high'
      })
      sourceContext.drawImage(bitmap, 0, 0, request.sourceWidth, request.sourceHeight)
    }
    const source = sourceContext.getImageData(0, 0, request.sourceWidth, request.sourceHeight)
    const composed = composeLayerStyleRaster(
      { width: source.width, height: source.height, data: source.data },
      request.styles,
      request.globalLight,
      request.resolutionScale,
      patterns
    )
    ensureCurrent(request.id)

    output = new OffscreenCanvas(composed.width, composed.height)
    const outputContext = output.getContext('2d', { alpha: true })
    if (!outputContext) throw new Error('Renderizador de estilos indisponível.')
    const outputPixels = new ImageData(composed.width, composed.height)
    outputPixels.data.set(composed.data)
    outputContext.putImageData(outputPixels, 0, 0)
    const blob = await output.convertToBlob({ type: 'image/png' })
    ensureCurrent(request.id)
    const message: LayerStyleWorkerResult = {
      id: request.id,
      result: {
        blob,
        width: composed.width,
        height: composed.height,
        offsetX: composed.offsetX,
        offsetY: composed.offsetY
      }
    }
    self.postMessage(message)
  } finally {
    bitmap?.close()
    if (sourceCanvas) {
      sourceCanvas.width = 1
      sourceCanvas.height = 1
    }
    if (output) {
      output.width = 1
      output.height = 1
    }
  }
}

self.onmessage = (event: MessageEvent<LayerStyleWorkerRequest>) => {
  if (event.data.type === 'cancel') {
    cancelled.add(event.data.id)
    return
  }
  const request = event.data
  queue = queue.then(() => render(request)).catch((error) => {
    if (error instanceof DOMException && error.name === 'AbortError') return
    const message: LayerStyleWorkerResult = {
      id: request.id,
      error: error instanceof Error ? error.message : 'Falha ao compor estilo de camada.'
    }
    self.postMessage(message)
  })
}

export {}
