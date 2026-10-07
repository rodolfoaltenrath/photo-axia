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
}

export interface RustDocumentCompositeJob {
  documentWidth: number
  documentHeight: number
  region: RustPixelPocRegion
  resolutionScale: number
  layersBottomToTop: readonly RustDocumentRasterLayer[]
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

function layout(job: RustDocumentCompositeJob) {
  if (!job || !job.region || !Array.isArray(job.layersBottomToTop) ||
      job.layersBottomToTop.length > MAX_LAYERS || job.resolutionScale !== 1) invalid()
  boundedInteger(job.documentWidth, 1, 0xffffffff)
  boundedInteger(job.documentHeight, 1, 0xffffffff)
  const region = { ...job.region }
  boundedInteger(region.x, 0, 0xffffffff); boundedInteger(region.y, 0, 0xffffffff)
  const outputBytes = rasterBytes(region.width, region.height)
  if (region.x + region.width > 0xffffffff || region.y + region.height > 0xffffffff) invalid()
  let packetBytes = HEADER + job.layersBottomToTop.length * RECORD
  for (const layer of job.layersBottomToTop) {
    if (!layer || !(layer.rgba instanceof Uint8Array) || !(layer.rgba.buffer instanceof ArrayBuffer) ||
        typeof layer.visible !== 'boolean' || !Number.isFinite(layer.opacity) ||
        layer.opacity < 0 || layer.opacity > 100 || !Object.hasOwn(MODES, layer.blendMode)) invalid()
    boundedInteger(layer.x, -0x80000000, 0x7fffffff)
    boundedInteger(layer.y, -0x80000000, 0x7fffffff)
    if (layer.rgba.byteLength !== rasterBytes(layer.width, layer.height)) invalid()
    packetBytes += layer.rgba.byteLength
  }
  const workingBytes = packetBytes + outputBytes + job.layersBottomToTop.length * 128
  if (packetBytes > MAX_BYTES || workingBytes > MAX_WORKING_BYTES) throw new RustPixelPocError('memory-limit')
  return { region, packetBytes, outputBytes, workingBytes }
}

export function encodeDocumentComposite(job: RustDocumentCompositeJob): Uint8Array<ArrayBuffer> {
  const { packetBytes } = layout(job)
  const bytes = new Uint8Array(packetBytes), view = new DataView(bytes.buffer)
  bytes.set([68, 67, 80, 49])
  for (const [offset, value] of [
    [4, 1], [8, HEADER], [12, job.layersBottomToTop.length],
    [16, job.documentWidth], [20, job.documentHeight], [24, job.region.x],
    [28, job.region.y], [32, job.region.width], [36, job.region.height]
  ] as const) view.setUint32(offset, value, true)
  view.setFloat64(40, job.resolutionScale, true)
  let cursor = HEADER + job.layersBottomToTop.length * RECORD
  job.layersBottomToTop.forEach((layer, index) => {
    const offset = HEADER + index * RECORD
    for (const [position, value] of [
      [0, cursor], [4, layer.rgba.byteLength], [8, layer.width], [12, layer.height],
      [24, layer.visible ? 1 : 0], [28, MODES[layer.blendMode]]
    ] as const) view.setUint32(offset + position, value, true)
    view.setInt32(offset + 16, layer.x, true); view.setInt32(offset + 20, layer.y, true)
    view.setFloat64(offset + 32, layer.opacity, true)
    bytes.set(layer.rgba, cursor)
    cursor += layer.rgba.byteLength
  })
  return bytes
}

export function documentCompositePacketLayout(packet: Uint8Array) {
  if (!(packet instanceof Uint8Array) || !(packet.buffer instanceof ArrayBuffer) ||
      packet.byteLength < HEADER || packet.byteLength > MAX_BYTES || packet.byteLength % 4 !== 0) invalid()
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
  if (view.getUint32(0, true) !== 0x31504344 || view.getUint32(4, true) !== 1 ||
      view.getUint32(8, true) !== HEADER) invalid()
  const count = view.getUint32(12, true)
  let cursor = HEADER + count * RECORD
  if (count > MAX_LAYERS || cursor > packet.byteLength) invalid()
  const layers: RustDocumentRasterLayer[] = []
  for (let index = 0; index < count; index++) {
    const offset = HEADER + index * RECORD
    const start = view.getUint32(offset, true), length = view.getUint32(offset + 4, true)
    const end = start + length, visible = view.getUint32(offset + 24, true)
    const blendMode = MODE_NAMES[view.getUint32(offset + 28, true)]
    if (start !== cursor || length === 0 || length % 4 !== 0 || end > packet.byteLength ||
        visible > 1 || !blendMode) invalid()
    layers.push({
      rgba: packet.subarray(start, end), width: view.getUint32(offset + 8, true),
      height: view.getUint32(offset + 12, true), x: view.getInt32(offset + 16, true),
      y: view.getInt32(offset + 20, true), visible: visible === 1,
      opacity: view.getFloat64(offset + 32, true), blendMode
    })
    cursor = end
  }
  if (cursor !== packet.byteLength) invalid()
  return layout({
    documentWidth: view.getUint32(16, true), documentHeight: view.getUint32(20, true),
    region: { x: view.getUint32(24, true), y: view.getUint32(28, true),
      width: view.getUint32(32, true), height: view.getUint32(36, true) },
    resolutionScale: view.getFloat64(40, true), layersBottomToTop: layers
  })
}
