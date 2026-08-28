import { cloneSelection, selectionIsEmpty, type SelectionRegion } from '../editor/selection.ts'
import {
  combineSelectionsCooperatively,
  type SelectionCombineMode,
  type SelectionDocumentSize
} from '../editor/selectionCombine.ts'

interface WorkerResponse {
  id: number
  result?: SelectionRegion | null
  error?: string
}

interface PendingCombination {
  resolve: (selection: SelectionRegion | null) => void
  reject: (error: Error | DOMException) => void
  cleanup: () => void
}

let combinationWorker: Worker | undefined
let nextCombinationId = 1
const pendingCombinations = new Map<number, PendingCombination>()

function abortError() {
  return new DOMException('Combinação de seleção cancelada.', 'AbortError')
}

function stopCombinationWorker(error: Error | DOMException, expectedWorker?: Worker) {
  if (expectedWorker && combinationWorker !== expectedWorker) return
  combinationWorker?.terminate()
  combinationWorker = undefined
  for (const pending of pendingCombinations.values()) {
    pending.cleanup()
    pending.reject(error)
  }
  pendingCombinations.clear()
}

function workerInstance() {
  if (typeof Worker === 'undefined') return undefined
  if (combinationWorker) return combinationWorker
  const worker = new Worker(new URL('../workers/selectionCombine.worker.ts', import.meta.url), { type: 'module' })
  combinationWorker = worker
  worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
    const pending = pendingCombinations.get(event.data.id)
    if (!pending) return
    pendingCombinations.delete(event.data.id)
    pending.cleanup()
    if (event.data.error) pending.reject(new Error(event.data.error))
    else if ('result' in event.data) pending.resolve(event.data.result ?? null)
    else pending.reject(new Error('A combinação retornou um resultado inválido.'))
  }
  worker.onerror = () => {
    stopCombinationWorker(new Error('A combinação de seleções foi interrompida.'), worker)
  }
  return worker
}

function trivialCombination(
  previous: SelectionRegion | null,
  incoming: SelectionRegion | null,
  mode: SelectionCombineMode,
  reuseInputs: boolean
): SelectionRegion | null | undefined {
  const first = selectionIsEmpty(previous) ? null : previous
  const second = selectionIsEmpty(incoming) ? null : incoming
  const result = (selection: SelectionRegion | null) => reuseInputs ? selection : cloneSelection(selection)
  if (mode === 'replace') return result(second)
  if (!first) return mode === 'add' ? result(second) : null
  if (!second) return mode === 'intersect' ? null : result(first)
  return undefined
}

function transferableSelectionBuffer(selection: SelectionRegion | null) {
  if (!selection || selection.kind !== 'pixels' || Array.isArray(selection.spans)) return undefined
  return selection.spans.data.buffer
}

export async function combineSelectionsAsync(
  previous: SelectionRegion | null,
  incoming: SelectionRegion | null,
  mode: SelectionCombineMode,
  document: SelectionDocumentSize,
  signal?: AbortSignal,
  /** The caller owns both snapshots, so trivial results may reuse them and packed buffers may be transferred. */
  transferInputs = false
): Promise<SelectionRegion | null> {
  signal?.throwIfAborted()
  const trivial = trivialCombination(previous, incoming, mode, transferInputs)
  if (trivial !== undefined) return trivial

  const worker = workerInstance()
  if (!worker) {
    return combineSelectionsCooperatively(previous, incoming, mode, document, {
      throwIfCancelled: () => signal?.throwIfAborted(),
      yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0))
    })
  }

  const id = nextCombinationId++
  return new Promise<SelectionRegion | null>((resolve, reject) => {
    const cancel = () => {
      if (pendingCombinations.has(id)) stopCombinationWorker(abortError(), worker)
    }
    const cleanup = () => signal?.removeEventListener('abort', cancel)
    pendingCombinations.set(id, { resolve, reject, cleanup })
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) {
      cancel()
      return
    }
    try {
      const transfer = transferInputs
        ? [...new Set([transferableSelectionBuffer(previous), transferableSelectionBuffer(incoming)]
            .filter((buffer): buffer is ArrayBuffer => Boolean(buffer)))]
        : []
      worker.postMessage({ id, previous, incoming, mode, document }, { transfer })
    } catch (error) {
      pendingCombinations.delete(id)
      cleanup()
      reject(error instanceof Error ? error : new Error('Não foi possível iniciar a combinação de seleções.'))
    }
  })
}

export function disposeSelectionCombineEngine() {
  stopCombinationWorker(abortError())
}
