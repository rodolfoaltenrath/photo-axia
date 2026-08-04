import { computed, shallowRef } from 'vue'

export interface HistoryEntry<T> {
  id: number
  label: string
  before: T
  after: T
  mergeKey?: string
  committedAt: number
}

export interface HistoryRecordOptions {
  mergeKey?: string
  mergeWindowMs?: number
}

export interface HistoryTransition<T> {
  label: string
  snapshot: T
}

export interface HistoryTimelineItem {
  id: string
  label: string
  position: number
  state: 'past' | 'current' | 'future'
}

export function useHistory<T>(limit = 80, initialLabel = 'Documento criado') {
  const past = shallowRef<HistoryEntry<T>[]>([])
  const future = shallowRef<HistoryEntry<T>[]>([])
  const baseLabel = shallowRef(initialLabel)
  let nextId = 1

  const canUndo = computed(() => past.value.length > 0)
  const canRedo = computed(() => future.value.length > 0)
  const undoLabel = computed(() => past.value.at(-1)?.label)
  const redoLabel = computed(() => future.value.at(-1)?.label)
  const currentPosition = computed(() => past.value.length)
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

  function record(label: string, before: T, after: T, options: HistoryRecordOptions = {}) {
    const committedAt = performance.now()
    const previous = past.value.at(-1)
    const mergeWindow = options.mergeWindowMs ?? 650
    if (
      options.mergeKey &&
      future.value.length === 0 &&
      previous?.mergeKey === options.mergeKey &&
      committedAt - previous.committedAt <= mergeWindow
    ) {
      past.value = [
        ...past.value.slice(0, -1),
        { ...previous, label, after, committedAt }
      ]
      return
    }

    const entry: HistoryEntry<T> = {
      id: nextId++,
      label,
      before,
      after,
      mergeKey: options.mergeKey,
      committedAt
    }
    const appended = [...past.value, entry]
    const discardedCount = Math.max(0, appended.length - limit)
    if (discardedCount) baseLabel.value = appended[discardedCount - 1]!.label
    past.value = appended.slice(discardedCount)
    future.value = []
  }

  function undo(): HistoryTransition<T> | undefined {
    const entry = past.value.at(-1)
    if (!entry) return undefined
    past.value = past.value.slice(0, -1)
    future.value = [...future.value, entry]
    return { label: entry.label, snapshot: entry.before }
  }

  function redo(): HistoryTransition<T> | undefined {
    const entry = future.value.at(-1)
    if (!entry) return undefined
    future.value = future.value.slice(0, -1)
    past.value = [...past.value, entry]
    return { label: entry.label, snapshot: entry.after }
  }

  function jump(position: number): HistoryTransition<T> | undefined {
    const chronological = [...past.value, ...future.value.slice().reverse()]
    const target = Math.max(0, Math.min(chronological.length, Math.round(position)))
    if (target === past.value.length || !chronological.length) return undefined

    past.value = chronological.slice(0, target)
    future.value = chronological.slice(target).reverse()
    return {
      label: target === 0 ? baseLabel.value : chronological[target - 1]!.label,
      snapshot: target === 0 ? chronological[0]!.before : chronological[target - 1]!.after
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
    currentPosition,
    entries,
    jump,
    record,
    redo,
    redoLabel,
    timeline,
    undo,
    undoLabel,
    clear
  }
}
