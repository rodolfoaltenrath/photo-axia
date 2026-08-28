import { combineSelections, type SelectionCombineMode, type SelectionDocumentSize } from '../editor/selectionCombine'
import type { SelectionRegion } from '../editor/selection'

interface SelectionCombineRequest {
  id: number
  previous: SelectionRegion
  incoming: SelectionRegion
  mode: SelectionCombineMode
  document: SelectionDocumentSize
}

self.onmessage = (event: MessageEvent<SelectionCombineRequest>) => {
  const request = event.data
  try {
    const result = combineSelections(request.previous, request.incoming, request.mode, request.document)
    const transfer = result?.kind === 'pixels' && !Array.isArray(result.spans)
      ? [result.spans.data.buffer]
      : []
    self.postMessage({ id: request.id, result }, { transfer })
  } catch (error) {
    self.postMessage({
      id: request.id,
      error: error instanceof Error ? error.message : 'Não foi possível combinar as seleções.'
    })
  }
}
