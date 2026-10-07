import type { LayerBlendMode } from '../types/editor.ts'
import type { RustPixelPocRegion } from './rustPixelPocRuntime.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'

const HEADER = 48, RECORD = 40, MAX_BYTES = 64 * 1024 * 1024
const MAX_WORKING_BYTES = 96 * 1024 * 1024, MAX_LAYERS = 1024, MAX_AXIS = 16384
const MODES: Readonly<Record<LayerBlendMode, number>> = {
  normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5
}
const MODE_NAMES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as const

export interface RustDocumentRasterLayer {
  rgba: Uint8Array
  width: number
  height: number
  x: number
  y: number
  visible: boolean
  opacity: number
  blendMode: LayerBlendMode
  sourceToDocument?: readonly [number, number, number, number, number, number]
}

export interface RustDocumentOutputGrid {
  scaleX: number
  scaleY: number
  originX: number
  originY: number
}

export interface RustDocumentCompositeJob {
  documentWidth: number
  documentHeight: number
  region: RustPixelPocRegion
  resolutionScale: number
  layersBottomToTop: readonly RustDocumentRasterLayer[]
  outputGrid?: RustDocumentOutputGrid
}

function invalid(): never { throw new RustPixelPocError('invalid-input') }
function boundedInteger(value: number, min: number, max: number) {
  if (!Number.isSafeInteger(value) || value < min || value > max) invalid()
}
function rasterBytes(width: number, height: number) {
  boundedInteger(width, 1, MAX_AXIS); boundedInteger(height, 1, MAX_AXIS)
  const bytes = width * height * 4
  if (bytes > MAX_BYTES) throw new RustPixelPocError('memory-limit')
  return bytes
}

function transformedWorkPixels(layer: RustDocumentRasterLayer, job: RustDocumentCompositeJob) {
  if (!layer.visible || layer.opacity === 0) return 0
  const [a, b, c, d, tx, ty] = layer.sourceToDocument!, grid = job.outputGrid!
  const points = [[0, 0], [layer.width, 0], [layer.width, layer.height], [0, layer.height]]
    .map(([x, y]) => [((a * x! + c * y! + tx) - grid.originX) * grid.scaleX, ((b * x! + d * y! + ty) - grid.originY) * grid.scaleY])
  const left = Math.max(Math.floor(Math.max(Math.min(...points.map(p => p[0]!)), -grid.originX * grid.scaleX)), job.region.x)
  const top = Math.max(Math.floor(Math.max(Math.min(...points.map(p => p[1]!)), -grid.originY * grid.scaleY)), job.region.y)
  const right = Math.min(Math.ceil(Math.min(Math.max(...points.map(p => p[0]!)), (job.documentWidth - grid.originX) * grid.scaleX)), job.region.x + job.region.width)
  const bottom = Math.min(Math.ceil(Math.min(Math.max(...points.map(p => p[1]!)), (job.documentHeight - grid.originY) * grid.scaleY)), job.region.y + job.region.height)
  return Math.max(0, right - left) * Math.max(0, bottom - top)
}

export function documentCompositeJobLayout(job: RustDocumentCompositeJob) {
  if (!job || !job.region || !Array.isArray(job.layersBottomToTop) ||
      job.layersBottomToTop.length > MAX_LAYERS || job.resolutionScale !== 1) invalid()
  boundedInteger(job.documentWidth, 1, 0xffffffff)
  boundedInteger(job.documentHeight, 1, 0xffffffff)
  const region = { ...job.region }
  boundedInteger(region.x, 0, 0xffffffff); boundedInteger(region.y, 0, 0xffffffff)
  const outputBytes = rasterBytes(region.width, region.height)
  if (region.x + region.width > 0xffffffff || region.y + region.height > 0xffffffff) invalid()
  const transformed = job.outputGrid !== undefined
  if (transformed) {
    const grid = job.outputGrid
    if (!grid || [grid.scaleX, grid.scaleY].some(v => !Number.isFinite(v) || v < 1 / 1024 || v > 128) ||
        [grid.originX, grid.originY].some(v => !Number.isFinite(v) || Math.abs(v) > 0xffffffff)) invalid()
  }
  const header = transformed ? 80 : HEADER, recordBytes = transformed ? 80 : RECORD
  let packetBytes = header + job.layersBottomToTop.length * recordBytes
  let workPixels = 0
  for (const layer of job.layersBottomToTop) {
    if (!layer || !(layer.rgba instanceof Uint8Array) || !(layer.rgba.buffer instanceof ArrayBuffer) ||
        typeof layer.visible !== 'boolean' || !Number.isFinite(layer.opacity) ||
        layer.opacity < 0 || layer.opacity > 100 || !Object.hasOwn(MODES, layer.blendMode)) invalid()
    boundedInteger(layer.x, -0x80000000, 0x7fffffff)
    boundedInteger(layer.y, -0x80000000, 0x7fffffff)
    if (transformed) {
      const matrix = layer.sourceToDocument
      if (!Array.isArray(matrix) || matrix.length !== 6 || layer.x !== 0 || layer.y !== 0) invalid()
      for (let index = 0; index < 6; index++) {
        if (!Number.isFinite(matrix[index]) || Math.abs(matrix[index]!) > (index < 4 ? 1_000_000 : 0xffffffff)) invalid()
      }
      const [a, b, c, d] = matrix, det = a * d - b * c
      if (!Number.isFinite(det) || Math.abs(det) < 1e-12 ||
          [d / det, -b / det, -c / det, a / det].some(v => !Number.isFinite(v) || Math.abs(v) > 1_000_000)) invalid()
    } else if (layer.sourceToDocument !== undefined) invalid()
    if (layer.rgba.byteLength !== rasterBytes(layer.width, layer.height)) invalid()
    if (transformed) {
      workPixels += transformedWorkPixels(layer, job)
      if (workPixels > 16 * 1024 * 1024) throw new RustPixelPocError('work-limit')
    }
    packetBytes += layer.rgba.byteLength
  }
  const workingBytes = packetBytes + outputBytes + job.layersBottomToTop.length * 128
  if (packetBytes > MAX_BYTES || workingBytes > MAX_WORKING_BYTES) throw new RustPixelPocError('memory-limit')
  return { region, packetBytes, outputBytes, workingBytes }
}

export function encodeDocumentComposite(job: RustDocumentCompositeJob): Uint8Array<ArrayBuffer> {
  const { packetBytes } = documentCompositeJobLayout(job)
  const transformed = job.outputGrid !== undefined, header = transformed ? 80 : HEADER, recordBytes = transformed ? 80 : RECORD
  const bytes = new Uint8Array(packetBytes), view = new DataView(bytes.buffer)
  bytes.set([68, 67, 80, transformed ? 50 : 49])
  for (const [offset, value] of [
    [4, transformed ? 2 : 1], [8, header], [12, job.layersBottomToTop.length],
    [16, job.documentWidth], [20, job.documentHeight], [24, job.region.x],
    [28, job.region.y], [32, job.region.width], [36, job.region.height]
  ] as const) view.setUint32(offset, value, true)
  if (transformed) {
    for (const [offset, value] of [[40, job.outputGrid!.scaleX], [48, job.outputGrid!.scaleY], [56, job.outputGrid!.originX], [64, job.outputGrid!.originY]] as const) view.setFloat64(offset, value, true)
  } else view.setFloat64(40, job.resolutionScale, true)
  let cursor = header + job.layersBottomToTop.length * recordBytes
  job.layersBottomToTop.forEach((layer, index) => {
    const offset = header + index * recordBytes
    for (const [position, value] of [
      [0, cursor], [4, layer.rgba.byteLength], [8, layer.width], [12, layer.height],
      [transformed ? 16 : 24, layer.visible ? 1 : 0], [transformed ? 20 : 28, MODES[layer.blendMode]]
    ] as const) view.setUint32(offset + position, value, true)
    if (transformed) layer.sourceToDocument!.forEach((value, field) => view.setFloat64(offset + 32 + field * 8, value, true))
    else { view.setInt32(offset + 16, layer.x, true); view.setInt32(offset + 20, layer.y, true) }
    view.setFloat64(offset + (transformed ? 24 : 32), layer.opacity, true)
    bytes.set(layer.rgba, cursor)
    cursor += layer.rgba.byteLength
  })
  return bytes
}

function parseDocumentComposite(packet: Uint8Array): RustDocumentCompositeJob {
  if (!(packet instanceof Uint8Array) || !(packet.buffer instanceof ArrayBuffer) ||
      packet.byteLength < HEADER || packet.byteLength > MAX_BYTES || packet.byteLength % 4 !== 0) invalid()
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
  const transformed = view.getUint32(0, true) === 0x32504344
  const header = transformed ? 80 : HEADER, recordBytes = transformed ? 80 : RECORD
  if (view.getUint32(0, true) !== (transformed ? 0x32504344 : 0x31504344) ||
      view.getUint32(4, true) !== (transformed ? 2 : 1) || view.getUint32(8, true) !== header || packet.length < header) invalid()
  if (transformed && (view.getUint32(72, true) !== 0 || view.getUint32(76, true) !== 0)) invalid()
  const count = view.getUint32(12, true)
  let cursor = header + count * recordBytes
  if (count > MAX_LAYERS || cursor > packet.byteLength) invalid()
  const layers: RustDocumentRasterLayer[] = []
  for (let index = 0; index < count; index++) {
    const offset = header + index * recordBytes
    const start = view.getUint32(offset, true), length = view.getUint32(offset + 4, true)
    const end = start + length, visible = view.getUint32(offset + (transformed ? 16 : 24), true)
    const blendMode = MODE_NAMES[view.getUint32(offset + (transformed ? 20 : 28), true)]
    if (start !== cursor || length === 0 || length % 4 !== 0 || end > packet.byteLength ||
        visible > 1 || !blendMode) invalid()
    layers.push({
      rgba: packet.subarray(start, end), width: view.getUint32(offset + 8, true),
      height: view.getUint32(offset + 12, true), x: transformed ? 0 : view.getInt32(offset + 16, true),
      y: transformed ? 0 : view.getInt32(offset + 20, true), visible: visible === 1,
      opacity: view.getFloat64(offset + (transformed ? 24 : 32), true), blendMode,
      ...(transformed ? { sourceToDocument: [0, 1, 2, 3, 4, 5].map(field => view.getFloat64(offset + 32 + field * 8, true)) as [number, number, number, number, number, number] } : {})
    })
    cursor = end
  }
  if (cursor !== packet.byteLength) invalid()
  const job: RustDocumentCompositeJob = {
    documentWidth: view.getUint32(16, true), documentHeight: view.getUint32(20, true),
    region: { x: view.getUint32(24, true), y: view.getUint32(28, true),
      width: view.getUint32(32, true), height: view.getUint32(36, true) },
    resolutionScale: transformed ? 1 : view.getFloat64(40, true), layersBottomToTop: layers,
    ...(transformed ? { outputGrid: { scaleX: view.getFloat64(40, true), scaleY: view.getFloat64(48, true), originX: view.getFloat64(56, true), originY: view.getFloat64(64, true) } } : {})
  }
  return job
}

export function decodeDocumentComposite(packet: Uint8Array) {
  const job = parseDocumentComposite(packet)
  documentCompositeJobLayout(job)
  return job
}

export function documentCompositePacketLayout(packet: Uint8Array) {
  return documentCompositeJobLayout(parseDocumentComposite(packet))
}
