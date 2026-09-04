import { composeLayerStyleRaster, type LayerStylePatternRasters } from '../editor/layerStyleRaster.ts'
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
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!context) throw new Error('Renderizador de estilos indisponível.')
    context.drawImage(bitmap, 0, 0)
    const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height)
    canvas.width = 1
    canvas.height = 1
    return { width: pixels.width, height: pixels.height, data: pixels.data }
  } finally {
    bitmap.close()
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
  const [bitmap, patterns] = await Promise.all([
    createImageBitmap(request.source, {
      resizeWidth: request.sourceWidth,
      resizeHeight: request.sourceHeight,
      resizeQuality: request.quality === 'interactive' ? 'medium' : 'high'
    }),
    decodePatterns(request.patterns)
  ])
  try {
    ensureCurrent(request.id)
    const sourceCanvas = new OffscreenCanvas(request.sourceWidth, request.sourceHeight)
    const sourceContext = sourceCanvas.getContext('2d', { alpha: true, willReadFrequently: true })
    if (!sourceContext) throw new Error('Renderizador de estilos indisponível.')
    sourceContext.drawImage(bitmap, 0, 0, request.sourceWidth, request.sourceHeight)
    const source = sourceContext.getImageData(0, 0, request.sourceWidth, request.sourceHeight)
    const composed = composeLayerStyleRaster(
      { width: source.width, height: source.height, data: source.data },
      request.styles,
      request.globalLight,
      request.resolutionScale,
      patterns
    )
    ensureCurrent(request.id)

    const output = new OffscreenCanvas(composed.width, composed.height)
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
    sourceCanvas.width = 1
    sourceCanvas.height = 1
    output.width = 1
    output.height = 1
  } finally {
    bitmap.close()
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
