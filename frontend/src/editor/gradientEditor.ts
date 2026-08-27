import {
  createGradientInterpolator,
  MAX_GRADIENT_COLOR_STOPS,
  MAX_GRADIENT_OPACITY_STOPS,
  normalizeGradientStopsConfig,
  type GradientColorStop,
  type GradientOpacityStop,
  type GradientStopsConfig
} from './gradient.ts'

export type GradientStopKind = 'color' | 'opacity'

export interface GradientColorPointResult {
  config: GradientStopsConfig
  colorStopId: string | null
}

export interface GradientStopSelection {
  kind: GradientStopKind
  id: string
}

function clampPosition(position: number) {
  if (!Number.isFinite(position)) return 0
  return Math.min(1, Math.max(0, position))
}

function uniqueId(config: GradientStopsConfig, kind: GradientStopKind) {
  const ids = new Set([...config.colorStops, ...config.opacityStops].map((stop) => stop.id))
  let index = 1
  let id = `${kind}-point-${index}`
  while (ids.has(id)) id = `${kind}-point-${++index}`
  return id
}

function uniqueLinkedIds(config: GradientStopsConfig) {
  const ids = new Set([...config.colorStops, ...config.opacityStops].map((stop) => stop.id))
  let index = 1
  while (ids.has(`color-linked-${index}`) || ids.has(`opacity-linked-${index}`)) index++
  return { colorId: `color-linked-${index}`, opacityId: `opacity-linked-${index}` }
}

function pairedOpacityStop(config: GradientStopsConfig, colorStop: GradientColorStop) {
  const linkedId = colorStop.id.startsWith('color-')
    ? `opacity-${colorStop.id.slice('color-'.length)}`
    : undefined
  const linked = linkedId
    ? config.opacityStops.find((stop) => stop.id === linkedId)
    : undefined
  if (linked) return linked
  const samePosition = config.opacityStops.filter(
    (stop) => Math.abs(stop.position - colorStop.position) <= Number.EPSILON
  )
  if (samePosition.length === 1) return samePosition[0]
  if (samePosition.length > 1) {
    const colorPeers = config.colorStops.filter(
      (stop) => Math.abs(stop.position - colorStop.position) <= Number.EPSILON
    )
    return samePosition[Math.max(0, colorPeers.findIndex((stop) => stop.id === colorStop.id))]
  }
  return undefined
}

function snapshot(config: GradientStopsConfig, changes: Partial<GradientStopsConfig>) {
  return normalizeGradientStopsConfig({ ...config, ...changes })
}

function rgbaHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
}

export function visualGradientStopPosition(config: GradientStopsConfig, position: number) {
  const normalized = clampPosition(position)
  return config.reversed ? 1 - normalized : normalized
}

export function storedGradientStopPosition(config: GradientStopsConfig, visualPosition: number) {
  const normalized = clampPosition(visualPosition)
  return config.reversed ? 1 - normalized : normalized
}

export function addGradientStop(
  input: GradientStopsConfig,
  kind: GradientStopKind,
  visualPosition: number
): { config: GradientStopsConfig; selection: GradientStopSelection | null } {
  const config = normalizeGradientStopsConfig(input)
  const limit = kind === 'color' ? MAX_GRADIENT_COLOR_STOPS : MAX_GRADIENT_OPACITY_STOPS
  const stops = kind === 'color' ? config.colorStops : config.opacityStops
  if (stops.length >= limit) return { config, selection: null }
  const position = storedGradientStopPosition(config, visualPosition)
  const id = uniqueId(config, kind)
  const rgba = createGradientInterpolator(config)(visualPosition)
  const next = kind === 'color'
    ? snapshot(config, {
        colorStops: [...config.colorStops, {
          id,
          position,
          color: rgbaHex(rgba[0], rgba[1], rgba[2])
        }]
      })
    : snapshot(config, {
        opacityStops: [...config.opacityStops, {
          id,
          position,
          opacity: Math.round(rgba[3] * 100 / 255)
        }]
      })
  return { config: next, selection: { kind, id } }
}

export function gradientColorStopOpacity(config: GradientStopsConfig, colorStopId: string) {
  const stop = config.colorStops.find((candidate) => candidate.id === colorStopId)
  if (!stop) return 100
  const progress = visualGradientStopPosition(config, stop.position)
  return Math.round(createGradientInterpolator(config)(progress)[3] * 100 / 255)
}

export function addGradientColorPoint(
  input: GradientStopsConfig,
  visualPosition: number
): GradientColorPointResult {
  const config = normalizeGradientStopsConfig(input)
  if (
    config.colorStops.length >= MAX_GRADIENT_COLOR_STOPS ||
    config.opacityStops.length >= MAX_GRADIENT_OPACITY_STOPS
  ) return { config, colorStopId: null }
  const position = storedGradientStopPosition(config, visualPosition)
  const [red, green, blue, alpha] = createGradientInterpolator(config)(visualPosition)
  const { colorId, opacityId } = uniqueLinkedIds(config)
  return {
    config: snapshot(config, {
      colorStops: [...config.colorStops, { id: colorId, position, color: rgbaHex(red, green, blue) }],
      opacityStops: [
        ...config.opacityStops,
        { id: opacityId, position, opacity: Math.round(alpha * 100 / 255) }
      ]
    }),
    colorStopId: colorId
  }
}

export function duplicateGradientColorPoint(
  input: GradientStopsConfig,
  colorStopId: string
): GradientColorPointResult {
  const config = normalizeGradientStopsConfig(input)
  const source = config.colorStops.find((stop) => stop.id === colorStopId)
  if (
    !source ||
    config.colorStops.length >= MAX_GRADIENT_COLOR_STOPS ||
    config.opacityStops.length >= MAX_GRADIENT_OPACITY_STOPS
  ) return { config, colorStopId: null }
  const { colorId, opacityId } = uniqueLinkedIds(config)
  return {
    config: snapshot(config, {
      colorStops: [...config.colorStops, { ...source, id: colorId }],
      opacityStops: [...config.opacityStops, {
        id: opacityId,
        position: source.position,
        opacity: gradientColorStopOpacity(config, source.id)
      }]
    }),
    colorStopId: colorId
  }
}

export function moveGradientColorPoint(
  input: GradientStopsConfig,
  colorStopId: string,
  visualPosition: number
) {
  const config = normalizeGradientStopsConfig(input)
  const colorStop = config.colorStops.find((stop) => stop.id === colorStopId)
  if (!colorStop) return config
  const opacityStop = pairedOpacityStop(config, colorStop)
  const position = storedGradientStopPosition(config, visualPosition)
  const opacity = gradientColorStopOpacity(config, colorStopId)
  return snapshot(config, {
    colorStops: config.colorStops.map((stop) => stop.id === colorStopId ? { ...stop, position } : stop),
    opacityStops: opacityStop
      ? config.opacityStops.map((stop) => stop.id === opacityStop.id ? { ...stop, position } : stop)
      : config.opacityStops.length < MAX_GRADIENT_OPACITY_STOPS
        ? [...config.opacityStops, {
            id: uniqueLinkedIds(config).opacityId,
            position,
            opacity
          }]
        : config.opacityStops
  })
}

export function updateGradientColorPointOpacity(
  input: GradientStopsConfig,
  colorStopId: string,
  value: number
) {
  const config = normalizeGradientStopsConfig(input)
  const colorStop = config.colorStops.find((stop) => stop.id === colorStopId)
  if (!colorStop) return config
  const opacityStop = pairedOpacityStop(config, colorStop)
  const opacity = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 100
  if (opacityStop) {
    return snapshot(config, {
      opacityStops: config.opacityStops.map((stop) => stop.id === opacityStop.id ? { ...stop, opacity } : stop)
    })
  }
  if (config.opacityStops.length >= MAX_GRADIENT_OPACITY_STOPS) return config
  return snapshot(config, {
    opacityStops: [...config.opacityStops, {
      id: uniqueLinkedIds(config).opacityId,
      position: colorStop.position,
      opacity
    }]
  })
}

export function removeGradientColorPoint(input: GradientStopsConfig, colorStopId: string) {
  const config = normalizeGradientStopsConfig(input)
  if (config.colorStops.length <= 2) return config
  const colorStop = config.colorStops.find((stop) => stop.id === colorStopId)
  if (!colorStop) return config
  const opacityStop = pairedOpacityStop(config, colorStop)
  return snapshot(config, {
    colorStops: config.colorStops.filter((stop) => stop.id !== colorStopId),
    opacityStops: opacityStop && config.opacityStops.length > 2
      ? config.opacityStops.filter((stop) => stop.id !== opacityStop.id)
      : config.opacityStops
  })
}

export function moveGradientStop(
  input: GradientStopsConfig,
  selection: GradientStopSelection,
  visualPosition: number
) {
  const config = input
  const position = storedGradientStopPosition(config, visualPosition)
  if (selection.kind === 'color') {
    return snapshot(config, {
      colorStops: config.colorStops.map((stop) => stop.id === selection.id ? { ...stop, position } : stop)
    })
  }
  return snapshot(config, {
    opacityStops: config.opacityStops.map((stop) => stop.id === selection.id ? { ...stop, position } : stop)
  })
}

export function updateGradientStopValue(
  input: GradientStopsConfig,
  selection: GradientStopSelection,
  value: string | number
) {
  const config = input
  if (selection.kind === 'color') {
    if (typeof value !== 'string' || !/^#[\da-f]{6}$/i.test(value)) return config
    return snapshot(config, {
      colorStops: config.colorStops.map((stop) => stop.id === selection.id
        ? { ...stop, color: value.toLowerCase() }
        : stop)
    })
  }
  const opacity = typeof value === 'number' && Number.isFinite(value)
    ? Math.min(100, Math.max(0, value))
    : 100
  return snapshot(config, {
    opacityStops: config.opacityStops.map((stop) => stop.id === selection.id
      ? { ...stop, opacity }
      : stop)
  })
}

export function removeGradientStop(
  input: GradientStopsConfig,
  selection: GradientStopSelection
): GradientStopsConfig {
  const config = input
  if (selection.kind === 'color') {
    if (config.colorStops.length <= 2) return config
    return snapshot(config, { colorStops: config.colorStops.filter((stop) => stop.id !== selection.id) })
  }
  if (config.opacityStops.length <= 2) return config
  return snapshot(config, { opacityStops: config.opacityStops.filter((stop) => stop.id !== selection.id) })
}

export function selectedGradientStop(
  config: GradientStopsConfig,
  selection: GradientStopSelection
): GradientColorStop | GradientOpacityStop | undefined {
  return selection.kind === 'color'
    ? config.colorStops.find((stop) => stop.id === selection.id)
    : config.opacityStops.find((stop) => stop.id === selection.id)
}

export function gradientStripBackground(config: GradientStopsConfig, sampleCount = 32) {
  const interpolate = createGradientInterpolator(config)
  const count = Math.max(2, Math.min(128, Math.floor(sampleCount) || 32))
  const samples = Array.from({ length: count }, (_, index) => {
    const position = index / (count - 1)
    const [red, green, blue, alpha] = interpolate(position)
    return `rgb(${red} ${green} ${blue} / ${(alpha / 255).toFixed(3)}) ${(position * 100).toFixed(2)}%`
  })
  return `linear-gradient(90deg, ${samples.join(', ')})`
}
