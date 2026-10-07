import { decodeDocumentComposite, documentCompositeJobLayout, encodeDocumentComposite,
  type RustDocumentCompositeJob } from './rustDocumentComposite.ts'
import { encodeStyleStages, styleStagesLayout, type RustPixelPocStagesPlan } from './rustPixelPocStages.ts'
import { RustPixelPocError } from './rustPixelPocError.ts'

const MAX_BYTES = 64 * 1024 * 1024, MAX_WORKING = 96 * 1024 * 1024, MAX_PASSES = 16 * 1024 * 1024
function invalid(): never { throw new RustPixelPocError('invalid-input') }
function admitted(value: number) {
  if (value > MAX_WORKING) throw new RustPixelPocError('memory-limit')
}

export function encodeStyledDocument(job: RustDocumentCompositeJob, plans: readonly (RustPixelPocStagesPlan | null)[]) {
  const document = documentCompositeJobLayout(job)
  if (!Array.isArray(plans) || plans.length !== job.layersBottomToTop.length) invalid()
  for (let index = 0; index < plans.length; index++) if (!(index in plans)) invalid()
  let packetBytes = 32 + plans.length * 8 + document.packetBytes, styledBytes = 0, metadata = 0, peak = 0, passes = 0
  const layouts = plans.map((plan, index) => {
    if (plan === null) return null
    const layer = job.layersBottomToTop[index]!
    const region = { x: 0, y: 0, width: layer.width, height: layer.height }
    const layout = styleStagesLayout(plan, layer.width, layer.height, region)
    const count = plan.external.length + plan.internal.length + plan.overlay.length + plan.upper.length
    packetBytes += layout.packetBytes; metadata += count * 2048
    if (layer.visible && layer.opacity > 0) {
      styledBytes += layer.rgba.byteLength
      peak = Math.max(peak, layer.rgba.byteLength * 2 + layout.peakFilterBytes + 2048)
      passes += layer.width * layer.height * (count + 1 + (plan.thisLayerBlendIf === undefined ? 0 : 1))
    }
    return layout
  })
  if (passes > MAX_PASSES) throw new RustPixelPocError('work-limit')
  if (packetBytes > MAX_BYTES) throw new RustPixelPocError('memory-limit')
  admitted(packetBytes + document.packetBytes + document.outputBytes + styledBytes + metadata + plans.length * 512 + peak)
  const packet = new Uint8Array(packetBytes), view = new DataView(packet.buffer)
  packet.set([83, 68, 80, 49]); view.setUint32(4, 1, true); view.setUint32(8, 32, true)
  view.setUint32(12, plans.length, true)
  const start = 32 + plans.length * 8
  view.setUint32(16, start, true); view.setUint32(20, document.packetBytes, true)
  packet.set(encodeDocumentComposite(job), start)
  let cursor = start + document.packetBytes
  plans.forEach((plan, index) => {
    if (plan === null) return
    const layer = job.layersBottomToTop[index]!
    const bytes = encodeStyleStages(plan, layer.width, layer.height, { x: 0, y: 0, width: layer.width, height: layer.height })
    if (bytes.length !== layouts[index]!.packetBytes) invalid()
    view.setUint32(32 + index * 8, cursor, true); view.setUint32(36 + index * 8, bytes.length, true)
    packet.set(bytes, cursor); cursor += bytes.length
  })
  return packet
}

export function styledDocumentPacketLayout(packet: Uint8Array) {
  if (!(packet instanceof Uint8Array) || !(packet.buffer instanceof ArrayBuffer) || packet.length < 32 ||
      packet.length > MAX_BYTES || packet.length % 4 !== 0) invalid()
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
  if (view.getUint32(0, true) !== 0x31504453 || view.getUint32(4, true) !== 1 || view.getUint32(8, true) !== 32 ||
      view.getUint32(24, true) !== 0 || view.getUint32(28, true) !== 0) invalid()
  const count = view.getUint32(12, true), documentOffset = view.getUint32(16, true), documentBytes = view.getUint32(20, true)
  let cursor = documentOffset + documentBytes
  if (count > 1024 || documentOffset !== 32 + count * 8 || cursor > packet.length) invalid()
  const sourcePacket = packet.subarray(documentOffset, cursor), job = decodeDocumentComposite(sourcePacket)
  if (job.layersBottomToTop.length !== count) invalid()
  let styledBytes = 0, metadata = 0, peakMinimum = 0, passes = 0
  for (let index = 0; index < count; index++) {
    const offset = view.getUint32(32 + index * 8, true), length = view.getUint32(36 + index * 8, true)
    if (offset === 0 && length === 0) continue
    if (offset !== cursor || length < 32 || length % 8 !== 0 || offset + length > packet.length) invalid()
    const style = new DataView(packet.buffer, packet.byteOffset + offset, length), effects = style.getUint32(8, true)
    if (style.getUint32(0, true) !== 0x31475453 || style.getUint32(4, true) !== 1 || effects > 64 ||
        32 + effects * 16 > length || style.getUint32(24, true) > 1) invalid()
    metadata += effects * 2048
    const layer = job.layersBottomToTop[index]!
    if (layer.visible && layer.opacity > 0) {
      styledBytes += layer.rgba.byteLength
      peakMinimum = Math.max(peakMinimum, layer.rgba.byteLength * 2 + 2048)
      passes += layer.width * layer.height * (effects + 1 + style.getUint32(24, true))
    }
    cursor += length
  }
  if (cursor !== packet.length) invalid()
  if (passes > MAX_PASSES) throw new RustPixelPocError('work-limit')
  // Rust validates nested effects and their filter peak before allocating rasters.
  const workingBytes = packet.length + documentBytes + job.region.width * job.region.height * 4 +
    styledBytes + metadata + count * 512 + peakMinimum
  admitted(workingBytes)
  return { documentOffset, documentBytes, layerCount: count, workingBytes }
}
