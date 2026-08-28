import {
  clipContextToSelection,
  drawVectorSelection,
  invertMatrix,
  layerSourceToDocumentMatrix,
  multiplyMatrices,
  opaquePixelBounds,
  SELECTION_EXTRACTION_ALPHA_THRESHOLD,
  selectionExtractionGeometry,
  transformSelectionPoint,
  type PixelSelection,
  type SelectionBounds,
  type SelectionPoint,
  type SelectionRegion,
  type WandResult
} from '../editor/selection'
import { colorRegionSpansCooperatively } from '../editor/colorRegion'
import type { ImageAsset, LayerTransform } from '../types/editor'

interface PendingWand {
  resolve: (result: WandResult) => void
  reject: (error: Error | DOMException) => void
  signal?: AbortSignal
  abortHandler?: () => void
}

let wandWorker: Worker | undefined
let nextRequestId = 1
const pendingWands = new Map<number, PendingWand>()

function cleanupPendingWand(pending: PendingWand) {
  if (pending.signal && pending.abortHandler) {
    pending.signal.removeEventListener('abort', pending.abortHandler)
  }
}

function stopWandWorker(error: Error | DOMException) {
  wandWorker?.terminate()
  wandWorker = undefined
  for (const pending of pendingWands.values()) {
    cleanupPendingWand(pending)
    pending.reject(error)
  }
  pendingWands.clear()
}

export interface EraseSelectionResult {
  blob: Blob
  width: number
  height: number
  /** Bounds of the remaining opaque pixels, in the *original* asset's source-pixel space. Null when nothing was trimmed. */
  trimmedBounds: SelectionBounds | null
}

interface PendingErase {
  resolve: (result: EraseSelectionResult) => void
  reject: (error: Error) => void
}

let eraseWorker: Worker | undefined
let nextEraseRequestId = 1
const pendingErases = new Map<number, PendingErase>()

export interface ExtractSelectionResult {
  blob: Blob
  width: number
  height: number
  sourceBounds: SelectionBounds
}

interface PendingExtract {
  resolve: (result: ExtractSelectionResult) => void
  reject: (error: Error) => void
}

let extractWorker: Worker | undefined
let nextExtractRequestId = 1
const pendingExtracts = new Map<number, PendingExtract>()

function extractWorkerInstance() {
  if (typeof Worker === 'undefined') return undefined
  if (extractWorker) return extractWorker
  extractWorker = new Worker(new URL('../workers/extractSelection.worker.ts', import.meta.url), { type: 'module' })
  extractWorker.onmessage = (event: MessageEvent<{ id: number; result?: ExtractSelectionResult; error?: string }>) => {
    const pending = pendingExtracts.get(event.data.id)
    if (!pending) return
    pendingExtracts.delete(event.data.id)
    if (event.data.error) pending.reject(new Error(event.data.error))
    else if (event.data.result) pending.resolve(event.data.result)
    else pending.reject(new Error('A cópia da seleção retornou um resultado inválido.'))
  }
  extractWorker.onerror = () => {
    for (const pending of pendingExtracts.values()) pending.reject(new Error('A cópia da seleção foi interrompida.'))
    pendingExtracts.clear()
    extractWorker?.terminate()
    extractWorker = undefined
  }
  return extractWorker
}

function eraseWorkerInstance() {
  if (typeof Worker === 'undefined') return undefined
  if (eraseWorker) return eraseWorker
  eraseWorker = new Worker(new URL('../workers/eraseSelection.worker.ts', import.meta.url), { type: 'module' })
  eraseWorker.onmessage = (event: MessageEvent<{ id: number; result?: EraseSelectionResult; error?: string }>) => {
    const pending = pendingErases.get(event.data.id)
    if (!pending) return
    pendingErases.delete(event.data.id)
    if (event.data.error) pending.reject(new Error(event.data.error))
    else if (event.data.result) pending.resolve(event.data.result)
    else pending.reject(new Error('O apagar retornou um resultado inválido.'))
  }
  eraseWorker.onerror = () => {
    for (const pending of pendingErases.values()) pending.reject(new Error('O apagar de pixels foi interrompido.'))
    pendingErases.clear()
    eraseWorker?.terminate()
    eraseWorker = undefined
  }
  return eraseWorker
}

function workerInstance() {
  if (typeof Worker === 'undefined') return undefined
  if (wandWorker) return wandWorker
  const worker = new Worker(new URL('../workers/magicWand.worker.ts', import.meta.url), { type: 'module' })
  wandWorker = worker
  worker.onmessage = (event: MessageEvent<{ id: number; result?: WandResult; error?: string }>) => {
    const pending = pendingWands.get(event.data.id)
    if (!pending) return
    pendingWands.delete(event.data.id)
    cleanupPendingWand(pending)
    if (event.data.error) pending.reject(new Error(event.data.error))
    else if (event.data.result) pending.resolve(event.data.result)
    else pending.reject(new Error('A varinha retornou uma seleção inválida.'))
  }
  worker.onerror = () => {
    if (wandWorker !== worker) return
    stopWandWorker(new Error('A varinha mágica foi interrompida.'))
  }
  return worker
}

async function fallbackWand(blob: Blob, x: number, y: number, tolerance: number, contiguous: boolean, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const bitmap = await createImageBitmap(blob)
  if (signal?.aborted) {
    bitmap.close()
    signal.throwIfAborted()
  }
  const canvas = document.createElement('canvas')
  canvas.width = bitmap.width
  canvas.height = bitmap.height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    bitmap.close()
    throw new Error('O sistema não disponibilizou leitura de pixels.')
  }
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const image = context.getImageData(0, 0, canvas.width, canvas.height)
  canvas.width = 1
  canvas.height = 1
  signal?.throwIfAborted()
  return colorRegionSpansCooperatively(
    image.data,
    image.width,
    image.height,
    { startX: x, startY: y, tolerance, contiguous },
    {
      throwIfCancelled: () => signal?.throwIfAborted(),
      yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0))
    }
  )
}

async function runWand(blob: Blob, x: number, y: number, tolerance: number, contiguous: boolean, signal?: AbortSignal) {
  signal?.throwIfAborted()
  const worker = workerInstance()
  if (!worker) return fallbackWand(blob, x, y, tolerance, contiguous, signal)
  const id = nextRequestId++
  return new Promise<WandResult>((resolve, reject) => {
    const abortHandler = () => stopWandWorker(new DOMException('Seleção cancelada.', 'AbortError'))
    const pending: PendingWand = { resolve, reject, signal, abortHandler }
    pendingWands.set(id, pending)
    signal?.addEventListener('abort', abortHandler, { once: true })
    if (signal?.aborted) {
      abortHandler()
      return
    }
    try {
      worker.postMessage({ id, blob, x, y, tolerance, contiguous })
    } catch (error) {
      pendingWands.delete(id)
      cleanupPendingWand(pending)
      reject(error instanceof Error ? error : new Error('Não foi possível iniciar a Varinha Mágica.'))
    }
  })
}

export async function createMagicWandSelection(
  layerId: string,
  asset: ImageAsset,
  transform: LayerTransform,
  documentPoint: SelectionPoint,
  tolerance: number,
  contiguous: boolean,
  signal?: AbortSignal
): Promise<PixelSelection> {
  signal?.throwIfAborted()
  const sourceToDocument = layerSourceToDocumentMatrix(transform, asset.width, asset.height)
  const sourcePoint = transformSelectionPoint(invertMatrix(sourceToDocument), documentPoint)
  if (sourcePoint.x < 0 || sourcePoint.y < 0 || sourcePoint.x >= asset.width || sourcePoint.y >= asset.height) {
    throw new Error('Clique dentro dos pixels da camada ativa.')
  }
  const response = await fetch(asset.sourceUrl, { signal })
  if (!response.ok) throw new Error('Não foi possível carregar os pixels da camada ativa.')
  const result = await runWand(await response.blob(), sourcePoint.x, sourcePoint.y, tolerance, contiguous, signal)
  signal?.throwIfAborted()
  return {
    kind: 'pixels',
    sourceLayerId: layerId,
    sourceWidth: asset.width,
    sourceHeight: asset.height,
    sourceToDocument,
    ...result
  }
}

async function encodeCanvas(canvas: HTMLCanvasElement | OffscreenCanvas) {
  if ('convertToBlob' in canvas) return canvas.convertToBlob({ type: 'image/png' })
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Não foi possível codificar a imagem editada.'))),
      'image/png'
    )
  })
}

function makeCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  return typeof OffscreenCanvas === 'undefined'
    ? Object.assign(document.createElement('canvas'), { width, height })
    : new OffscreenCanvas(width, height)
}

function canvas2dContext(canvas: HTMLCanvasElement | OffscreenCanvas) {
  const context = canvas.getContext('2d', { alpha: true, willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null
  if (!context) throw new Error('O sistema não disponibilizou o renderizador 2D.')
  return context
}

async function fallbackExtract(
  sourceBlob: Blob,
  asset: ImageAsset,
  transform: LayerTransform,
  selection: SelectionRegion
): Promise<ExtractSelectionResult> {
  const geometry = selectionExtractionGeometry(asset.width, asset.height, transform, selection)
  if (!geometry.width || !geometry.height) throw new Error('A seleção não intersecta a camada ativa.')
  const bitmap = await createImageBitmap(sourceBlob)
  const canvas = makeCanvas(geometry.width, geometry.height)
  const context = canvas2dContext(canvas)
  const documentToOutput = multiplyMatrices(
    [1, 0, 0, 1, -geometry.originX, -geometry.originY],
    geometry.documentToSource
  )
  context.save()
  clipContextToSelection(context, selection, documentToOutput)
  context.setTransform(1, 0, 0, 1, -geometry.originX, -geometry.originY)
  context.drawImage(bitmap, 0, 0, asset.width, asset.height)
  context.restore()
  bitmap.close()

  const image = context.getImageData(0, 0, geometry.width, geometry.height)
  const opaqueBounds = opaquePixelBounds(
    image.data,
    geometry.width,
    geometry.height,
    SELECTION_EXTRACTION_ALPHA_THRESHOLD
  )
  if (!opaqueBounds) throw new Error('A seleção não contém pixels visíveis nesta camada.')
  const trimmed =
    opaqueBounds.x > 0 ||
    opaqueBounds.y > 0 ||
    opaqueBounds.width < geometry.width ||
    opaqueBounds.height < geometry.height
  const output = trimmed ? makeCanvas(opaqueBounds.width, opaqueBounds.height) : canvas
  if (trimmed) {
    canvas2dContext(output).putImageData(
      image,
      -opaqueBounds.x,
      -opaqueBounds.y,
      opaqueBounds.x,
      opaqueBounds.y,
      opaqueBounds.width,
      opaqueBounds.height
    )
  }
  const blob = await encodeCanvas(output)
  canvas.width = 1
  canvas.height = 1
  if (output !== canvas) {
    output.width = 1
    output.height = 1
  }
  return {
    blob,
    width: opaqueBounds.width,
    height: opaqueBounds.height,
    sourceBounds: {
      x: geometry.originX + opaqueBounds.x,
      y: geometry.originY + opaqueBounds.y,
      width: opaqueBounds.width,
      height: opaqueBounds.height
    }
  }
}

async function fallbackErase(
  sourceBlob: Blob,
  asset: ImageAsset,
  transform: LayerTransform,
  selection: SelectionRegion
): Promise<EraseSelectionResult> {
  const bitmap = await createImageBitmap(sourceBlob)
  const canvas = makeCanvas(asset.width, asset.height)
  const context = canvas2dContext(canvas)
  context.drawImage(bitmap, 0, 0, asset.width, asset.height)
  bitmap.close()

  const documentToSource = invertMatrix(layerSourceToDocumentMatrix(transform, asset.width, asset.height))
  const matrix = selection.kind === 'pixels'
    ? multiplyMatrices(documentToSource, selection.sourceToDocument)
    : documentToSource
  context.save()
  context.globalCompositeOperation = 'destination-out'
  context.setTransform(...matrix)
  drawVectorSelection(context, selection)
  context.restore()

  const image = context.getImageData(0, 0, asset.width, asset.height)
  const opaqueBounds = opaquePixelBounds(image.data, asset.width, asset.height)
  const fullyTrimmed =
    opaqueBounds &&
    (opaqueBounds.x > 0 ||
      opaqueBounds.y > 0 ||
      opaqueBounds.width < asset.width ||
      opaqueBounds.height < asset.height)

  if (!opaqueBounds || !fullyTrimmed) {
    const blob = await encodeCanvas(canvas)
    canvas.width = 1
    canvas.height = 1
    return { blob, width: asset.width, height: asset.height, trimmedBounds: null }
  }

  const trimmedCanvas = makeCanvas(opaqueBounds.width, opaqueBounds.height)
  const trimmedContext = canvas2dContext(trimmedCanvas)
  trimmedContext.putImageData(
    image,
    -opaqueBounds.x,
    -opaqueBounds.y,
    opaqueBounds.x,
    opaqueBounds.y,
    opaqueBounds.width,
    opaqueBounds.height
  )
  const blob = await encodeCanvas(trimmedCanvas)
  canvas.width = 1
  canvas.height = 1
  trimmedCanvas.width = 1
  trimmedCanvas.height = 1
  return { blob, width: opaqueBounds.width, height: opaqueBounds.height, trimmedBounds: opaqueBounds }
}

export async function eraseImageSelection(
  asset: ImageAsset,
  transform: LayerTransform,
  selection: SelectionRegion
): Promise<EraseSelectionResult> {
  const response = await fetch(asset.sourceUrl)
  if (!response.ok) throw new Error('Não foi possível carregar a camada para edição.')
  const blob = await response.blob()

  const worker = eraseWorkerInstance()
  if (!worker) return fallbackErase(blob, asset, transform, selection)

  const id = nextEraseRequestId++
  return new Promise<EraseSelectionResult>((resolve, reject) => {
    pendingErases.set(id, { resolve, reject })
    worker.postMessage({ id, blob, assetWidth: asset.width, assetHeight: asset.height, transform, selection })
  })
}

export async function extractImageSelection(
  asset: ImageAsset,
  transform: LayerTransform,
  selection: SelectionRegion
): Promise<ExtractSelectionResult> {
  const response = await fetch(asset.sourceUrl)
  if (!response.ok) throw new Error('Não foi possível carregar a camada para copiar a seleção.')
  const blob = await response.blob()
  const worker = extractWorkerInstance()
  if (!worker) return fallbackExtract(blob, asset, transform, selection)

  const id = nextExtractRequestId++
  return new Promise<ExtractSelectionResult>((resolve, reject) => {
    pendingExtracts.set(id, { resolve, reject })
    worker.postMessage({ id, blob, assetWidth: asset.width, assetHeight: asset.height, transform, selection })
  })
}

export function disposeSelectionEngine() {
  stopWandWorker(new DOMException('Seleção cancelada.', 'AbortError'))
  eraseWorker?.terminate()
  eraseWorker = undefined
  for (const pending of pendingErases.values()) pending.reject(new Error('Apagar cancelado.'))
  pendingErases.clear()
  extractWorker?.terminate()
  extractWorker = undefined
  for (const pending of pendingExtracts.values()) pending.reject(new Error('Cópia da seleção cancelada.'))
  pendingExtracts.clear()
}
