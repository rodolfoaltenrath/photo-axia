import { computed, shallowRef } from 'vue'

export type HistoryDirection = 'undo' | 'redo'

export interface HistoryStep<T> {
  delta: T
  direction: HistoryDirection
}

export interface HistoryNavigation<T> {
  label: string
  steps: HistoryStep<T>[]
}

export interface HistoryEntry<T> {
  id: number
  label: string
  delta: T
  mergeKey?: string
  committedAt: number
  bytes: number
}

export interface HistoryRecordOptions {
  mergeKey?: string
  mergeWindowMs?: number
}

export interface HistoryOptions<T> {
  isNoop?: (delta: T) => boolean
  maxBytes?: number
  maxEntries?: number
  estimateBytes?: (delta: T) => number
  merge?: (previous: T, next: T) => T
}

export interface HistoryTimelineItem {
  id: string
  label: string
  position: number
  state: 'past' | 'current' | 'future'
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_ENTRIES = 200

export function useHistory<T>(options: HistoryOptions<T> = {}, initialLabel = 'Documento criado') {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  const estimateBytes = options.estimateBytes ?? (() => 128)
  const past = shallowRef<HistoryEntry<T>[]>([])
  const future = shallowRef<HistoryEntry<T>[]>([])
  const baseLabel = shallowRef(initialLabel)
  let nextId = 1

  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)
  const undoLabel = computed(() => past.value.at(-1)?.label)
  const redoLabel = computed(() => future.value.at(-1)?.label)
  const currentPosition = computed(() => past.value.length)
  const currentRevision = computed(() => past.value.at(-1)?.id ?? 0)
  const sizeBytes = computed(() =>
    [...past.value, ...future.value].reduce((total, entry) => total + entry.bytes, 0)
  )
  const timeline = computed<HistoryTimelineItem[]>(() => {
    const chronological = [...past.value, ...future.value.slice().reverse()]
    const current = past.value.length
    return [
      {
        id: 'base',
        label: baseLabel.value,
        position: 0,
        state: current === 0 ? 'current' : 'past'
      },
      ...chronological.map((entry, index) => {
        const position = index + 1
        return {
          id: String(entry.id),
          label: entry.label,
          position,
          state: position === current ? 'current' : position < current ? 'past' : 'future'
        } satisfies HistoryTimelineItem
      })
    ]
  })

  function trim(entries: HistoryEntry<T>[]) {
    let bytes = entries.reduce((total, entry) => total + entry.bytes, 0)
    let discarded = 0
    while (entries.length - discarded > 1 && (entries.length - discarded > maxEntries || bytes > maxBytes)) {
      bytes -= entries[discarded]!.bytes
      baseLabel.value = entries[discarded]!.label
      discarded++
    }
    return {
      discarded: discarded ? entries.slice(0, discarded) : [],
      retained: discarded ? entries.slice(discarded) : entries
    }
  }

  function record(label: string, delta: T, recordOptions: HistoryRecordOptions = {}) {
    if (options.isNoop?.(delta)) return []
    const committedAt = performance.now()
    const previous = past.value.at(-1)
    const mergeWindow = recordOptions.mergeWindowMs ?? 650
    if (
      recordOptions.mergeKey &&
      options.merge &&
      future.value.length === 0 &&
      previous?.mergeKey === recordOptions.mergeKey &&
      committedAt - previous.committedAt <= mergeWindow
    ) {
      const mergedDelta = options.merge(previous.delta, delta)
      if (options.isNoop?.(mergedDelta)) {
        past.value = past.value.slice(0, -1)
        return [previous]
      }
      const mergedEntry = {
        ...previous,
        id: nextId++,
        label,
        delta: mergedDelta,
        committedAt,
        bytes: Math.max(1, estimateBytes(mergedDelta))
      }
      const result = trim([...past.value.slice(0, -1), mergedEntry])
      past.value = result.retained
      return [previous, ...result.discarded]
    }

    const entry: HistoryEntry<T> = {
      id: nextId++,
      label,
      delta,
      mergeKey: recordOptions.mergeKey,
      committedAt,
      bytes: Math.max(1, estimateBytes(delta))
    }
    const discardedFuture = future.value
    const result = trim([...past.value, entry])
    past.value = result.retained
    future.value = []
    return [...discardedFuture, ...result.discarded]
  }

  function undo(): HistoryNavigation<T> | undefined {
    const entry = past.value.at(-1)
    if (!entry) return undefined
    past.value = past.value.slice(0, -1)
    future.value = [...future.value, entry]
    return { label: entry.label, steps: [{ delta: entry.delta, direction: 'undo' }] }
  }

  function redo(): HistoryNavigation<T> | undefined {
    const entry = future.value.at(-1)
    if (!entry) return undefined
    future.value = future.value.slice(0, -1)
    past.value = [...past.value, entry]
    return { label: entry.label, steps: [{ delta: entry.delta, direction: 'redo' }] }
  }

  function jump(position: number): HistoryNavigation<T> | undefined {
    const chronological = [...past.value, ...future.value.slice().reverse()]
    const current = past.value.length
    const target = Math.max(0, Math.min(chronological.length, Math.round(position)))
    if (target === current || !chronological.length) return undefined

    const steps: HistoryStep<T>[] = target < current
      ? chronological.slice(target, current).reverse().map((entry) => ({ delta: entry.delta, direction: 'undo' }))
      : chronological.slice(current, target).map((entry) => ({ delta: entry.delta, direction: 'redo' }))
    past.value = chronological.slice(0, target)
    future.value = chronological.slice(target).reverse()
    return {
      label: target === 0 ? baseLabel.value : chronological[target - 1]!.label,
      steps
    }
  }

  function clear(label = 'Documento criado') {
    past.value = []
    future.value = []
    baseLabel.value = label
  }

  function entries() {
    return [...past.value, ...future.value]
  }

  return {
    canRedo,
    canUndo,
    clear,
    currentPosition,
    currentRevision,
    entries,
    jump,
    record,
    redo,
    redoLabel,
    sizeBytes,
    timeline,
    undo,
    undoLabel
  }
}
