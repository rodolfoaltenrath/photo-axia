import type { RustPixelPocResponse } from './rustPixelPocProtocol.ts'

type StagedSource = Extract<RustPixelPocResponse, { type: 'source-staged' }>
type StagedTile = Extract<RustPixelPocResponse, { type: 'rendered-staged-region' | 'encoded-staged-region' }>

/** Experimental reply guard; not connected to the editor. */
export class RustPixelPocTileGate {
  private generation = 0
  private sourceId: number | null = null
  private viewEpoch = 0
  private readonly latestTileToken = new Map<string, symbol>()

  beginSourceChange(): number {
    if (this.generation === Number.MAX_SAFE_INTEGER) {
      throw new Error('source-generation-exhausted')
    }
    this.generation++
    this.sourceId = null
    this.beginViewChange()
    return this.generation
  }

  adoptSource(response: StagedSource): boolean {
    if (response.generation !== this.generation || this.sourceId !== null ||
        !Number.isSafeInteger(response.sourceId) || response.sourceId <= 0) return false
    this.sourceId = response.sourceId
    this.beginViewChange()
    return true
  }

  beginViewChange() {
    this.viewEpoch++
    this.latestTileToken.clear()
  }

  captureTile<T extends StagedTile['type'] = 'rendered-staged-region'>(key: string, requestId: number,
    responseType: T = 'rendered-staged-region' as T) {
    if (this.sourceId === null) return null
    if (!Number.isSafeInteger(requestId) || requestId <= 0) return null
    const token = Symbol(key)
    this.latestTileToken.set(key, token)
    const generation = this.generation
    const sourceId = this.sourceId
    const viewEpoch = this.viewEpoch
    return {
      sourceId,
      generation,
      isCurrent: (response: RustPixelPocResponse): response is Extract<StagedTile, { type: T }> =>
        (response.type === 'rendered-staged-region' || response.type === 'encoded-staged-region') &&
        response.type === responseType &&
        response.id === requestId &&
        response.sourceId === sourceId && response.generation === generation &&
        this.sourceId === sourceId && this.generation === generation &&
        this.viewEpoch === viewEpoch && this.latestTileToken.get(key) === token
    }
  }
}
