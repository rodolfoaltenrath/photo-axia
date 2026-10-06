import { RustPixelPocError } from './rustPixelPocError.ts'
import { alphaMaskLayout } from './rustPixelPocAlphaMask.ts'
import { encodeLocalBatch, localBatchPacketLength, validateBatchBlendIf, type RustPixelPocBatchEffect } from './rustPixelPocBatch.ts'
import { encodeDropShadow, dropShadowLayout, prepareRustDropShadow, type RustPixelPocDropShadow } from './rustPixelPocDropShadow.ts'
import { encodeInnerShadow, innerShadowLayout, prepareRustInnerShadow, type RustPixelPocInnerShadow } from './rustPixelPocInnerShadow.ts'
import { encodeGlow, glowLayout, prepareRustGlow, type RustPixelPocGlow } from './rustPixelPocGlow.ts'
import { encodeSatin, satinLayout, prepareRustSatin, type RustPixelPocSatin } from './rustPixelPocSatin.ts'
import { encodeStroke, strokePacketLength, strokeLayout, prepareRustStroke, type RustPixelPocStroke } from './rustPixelPocStroke.ts'
import { encodeBevel, bevelPacketLength, bevelLayout, prepareRustBevel, type RustPixelPocBevel } from './rustPixelPocBevel.ts'
import { buildLayerStylePipeline } from './layerStyleCompositor.ts'
import type { LayerStyleConfig, LayerStyleGlobalLight } from '../types/editor.ts'
import type { RustPixelPocBlendIf, RustPixelPocRegion, RustPixelPocPatternRaster } from './rustPixelPocRuntime.ts'

export interface RustPixelPocStagesPlan {
  fillOpacity: number
  external: ({ type: 'drop-shadow'; shadow: RustPixelPocDropShadow } | { type: 'outer-glow'; glow: RustPixelPocGlow })[]
  internal: ({ type: 'inner-shadow'; shadow: RustPixelPocInnerShadow } | { type: 'inner-glow'; glow: RustPixelPocGlow } | { type: 'satin'; satin: RustPixelPocSatin })[]
  overlay: RustPixelPocBatchEffect[]
  upper: ({ type: 'bevel-emboss'; bevel: RustPixelPocBevel } | { type: 'stroke'; stroke: RustPixelPocStroke })[]
  thisLayerBlendIf?: RustPixelPocBlendIf
}
const channels = { gray: 0, red: 1, green: 2, blue: 3 } as const
function invalid(): never { throw new RustPixelPocError('invalid-input') }
function color(value: string): [number, number, number, number] {
  if (typeof value !== 'string' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) invalid()
  return [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16), Number.parseInt(value.slice(5, 7), 16),
    value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) : 255]
}
export function prepareRustStyleStages(styles: LayerStyleConfig, light: LayerStyleGlobalLight, scale: number,
  patterns: ReadonlyMap<string, RustPixelPocPatternRaster> = new Map()): RustPixelPocStagesPlan {
  if (!styles || !light || !Number.isFinite(scale) || scale <= 0 || scale > 8) invalid()
  const pipeline = buildLayerStylePipeline(styles)
  const plan: RustPixelPocStagesPlan = { fillOpacity: styles.fillOpacity, external: [], internal: [], overlay: [], upper: [],
    thisLayerBlendIf: { channel: styles.blendIf.channel, shadows: [...styles.blendIf.thisLayer.shadows], highlights: [...styles.blendIf.thisLayer.highlights] } }
  const range = styles.blendIf.thisLayer
  if (range.shadows[0] === 0 && range.shadows[1] === 0 && range.highlights[0] === 255 && range.highlights[1] === 255) delete plan.thisLayerBlendIf
  for (const effect of pipeline.external) switch (effect.type) {
    case 'drop-shadow': plan.external.push({ type: effect.type, shadow: prepareRustDropShadow(effect, light, scale) }); break
    case 'outer-glow': plan.external.push({ type: effect.type, glow: prepareRustGlow(effect, scale) }); break
    default: effect satisfies never; invalid()
  }
  for (const effect of pipeline.internal) switch (effect.type) {
    case 'inner-shadow': plan.internal.push({ type: effect.type, shadow: prepareRustInnerShadow(effect, light, scale) }); break
    case 'inner-glow': plan.internal.push({ type: effect.type, glow: prepareRustGlow(effect, scale) }); break
    case 'satin': plan.internal.push({ type: effect.type, satin: prepareRustSatin(effect, scale) }); break
    default: effect satisfies never; invalid()
  }
  for (const effect of pipeline.overlay) switch (effect.type) {
    case 'color-overlay': plan.overlay.push({ type: effect.type, effect: { color: color(effect.color), opacity: effect.opacity, blendMode: effect.blendMode } }); break
    case 'gradient-overlay': plan.overlay.push({ type: effect.type, effect: { angle: effect.angle, scale: effect.scale, reverse: effect.reverse,
      opacity: effect.opacity, blendMode: effect.blendMode, gradient: { type: effect.gradient.type,
        colorStops: effect.gradient.colorStops.map(stop => ({ position: stop.position, color: color(stop.color) })),
        opacityStops: effect.gradient.opacityStops.map(stop => ({ position: stop.position, opacity: stop.opacity })) } } }); break
    case 'pattern-overlay': {
      if (!effect.pattern) break
      const pattern = patterns.get(effect.pattern.id)
      if (!pattern) invalid()
      plan.overlay.push({ type: effect.type, pattern, effect: { angle: effect.angle, scale: effect.scale, opacity: effect.opacity, blendMode: effect.blendMode } }); break
    }
    default: effect satisfies never; invalid()
  }
  for (const effect of pipeline.upper) switch (effect.type) {
    case 'bevel-emboss': plan.upper.push({ type: effect.type, bevel: prepareRustBevel(effect, light, scale, effect.texture && patterns.get(effect.texture.id)) }); break
    case 'stroke': plan.upper.push({ type: effect.type, stroke: prepareRustStroke(effect, scale,
      effect.paint.type === 'pattern' && effect.paint.pattern ? patterns.get(effect.paint.pattern.id) : undefined) }); break
    default: effect satisfies never; invalid()
  }
  return plan
}

function preparePacket(plan: RustPixelPocStagesPlan, width: number, height: number, region: RustPixelPocRegion) {
  if (!plan || !Number.isFinite(plan.fillOpacity) || plan.fillOpacity < 0 || plan.fillOpacity > 100 ||
      [plan.external, plan.internal, plan.overlay, plan.upper].some(list => !Array.isArray(list) || list.length > 64)) invalid()
  const count = plan.external.length + plan.internal.length + plan.overlay.length + plan.upper.length
  if (count > 64) invalid()
  if (plan.thisLayerBlendIf !== undefined) validateBatchBlendIf(plan.thisLayerBlendIf)
  alphaMaskLayout(width, height, region, { spreadRadius: 0, blurRadius: 0, precise: false })
  const sourceBytes = width * height * 4, tileBytes = region.width * region.height * 4
  const parts: { kind: number; stage: number; length: number; encode(): Uint8Array }[] = []
  let length = 32 + count * 16, peakFilterBytes = 0
  function add(kind: number, stage: number, bytes: number, workingBytes: number, metadata: number, encode: () => Uint8Array) {
    const filters = Math.max(0, workingBytes - sourceBytes - tileBytes * 2 - bytes - metadata)
    peakFilterBytes = Math.max(peakFilterBytes, filters)
    length += Math.ceil(bytes / 8) * 8
    parts.push({ kind, stage, length: bytes, encode })
  }
  for (const pass of plan.external) {
    if (!pass) invalid()
    switch (pass.type) {
      case 'drop-shadow': {
        const packet = encodeDropShadow(pass.shadow), layout = dropShadowLayout(width, height, region, pass.shadow, packet.length)
        add(1, 0, packet.length, layout.workingBytes, 512, () => packet); break
      }
      case 'outer-glow': {
        if (pass.glow?.kind !== 'outer') invalid()
        const packet = encodeGlow(pass.glow), layout = glowLayout(width, height, region, pass.glow, packet.length)
        add(2, 0, packet.length, layout.workingBytes, 2048, () => packet); break
      }
      default: pass satisfies never; invalid()
    }
  }
  for (const pass of plan.internal) {
    if (!pass) invalid()
    switch (pass.type) {
      case 'inner-shadow': {
        const packet = encodeInnerShadow(pass.shadow), layout = innerShadowLayout(width, height, region, pass.shadow, packet.length)
        add(3, 2, packet.length, layout.workingBytes, 512, () => packet); break
      }
      case 'inner-glow': {
        if (!pass.glow || !['inner-edge', 'inner-center'].includes(pass.glow.kind)) invalid()
        const packet = encodeGlow(pass.glow), layout = glowLayout(width, height, region, pass.glow, packet.length)
        add(4, 2, packet.length, layout.workingBytes, 2048, () => packet); break
      }
      case 'satin': {
        const packet = encodeSatin(pass.satin), layout = satinLayout(width, height, region, pass.satin, packet.length)
        add(5, 2, packet.length, layout.workingBytes, 512, () => packet); break
      }
      default: pass satisfies never; invalid()
    }
  }
  for (const pass of plan.overlay) {
    const batch = { fillOpacity: 0, effects: [pass] }, bytes = localBatchPacketLength(batch)
    add(6, 3, bytes, 0, 0, () => encodeLocalBatch(batch, 4, 4))
  }
  for (const pass of plan.upper) {
    if (!pass) invalid()
    switch (pass.type) {
      case 'bevel-emboss': {
        const bytes = bevelPacketLength(pass.bevel), layout = bevelLayout(width, height, region, pass.bevel, bytes)
        add(7, 4, bytes, layout.workingBytes, 1024, () => encodeBevel(pass.bevel)); break
      }
      case 'stroke': {
        const bytes = strokePacketLength(pass.stroke), layout = strokeLayout(width, height, region, pass.stroke, bytes)
        add(8, 4, bytes, layout.workingBytes, 2048, () => encodeStroke(pass.stroke)); break
      }
      default: pass satisfies never; invalid()
    }
  }
  const workingBytes = sourceBytes + length + tileBytes * 3 + count * 2048 + peakFilterBytes
  if (length > 64 * 1024 * 1024 || workingBytes > 96 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
  return { parts, length, workingBytes, peakFilterBytes }
}
export function styleStagesLayout(plan: RustPixelPocStagesPlan, width: number, height: number, region: RustPixelPocRegion) {
  const { length, workingBytes, peakFilterBytes } = preparePacket(plan, width, height, region)
  return { packetBytes: length, workingBytes, peakFilterBytes }
}
export function encodeStyleStages(plan: RustPixelPocStagesPlan, width: number, height: number, region: RustPixelPocRegion) {
  const { parts, length } = preparePacket(plan, width, height, region), packet = new Uint8Array(length), view = new DataView(packet.buffer)
  view.setUint32(0, 0x31475453, true); view.setUint32(4, 1, true); view.setUint32(8, parts.length, true)
  view.setFloat64(16, plan.fillOpacity, true)
  if (plan.thisLayerBlendIf !== undefined) {
    packet.set([...plan.thisLayerBlendIf.shadows, ...plan.thisLayerBlendIf.highlights], 12)
    view.setUint32(24, 1, true); view.setUint32(28, channels[plan.thisLayerBlendIf.channel], true)
  }
  let offset = 32 + parts.length * 16
  for (const [index, part] of parts.entries()) {
    const record = 32 + index * 16
    view.setUint32(record, part.kind, true); view.setUint32(record + 4, part.stage, true)
    view.setUint32(record + 8, offset, true); view.setUint32(record + 12, part.length, true)
    const bytes = part.encode()
    if (bytes.length !== part.length) invalid()
    packet.set(bytes, offset); offset += Math.ceil(bytes.length / 8) * 8
  }
  return packet
}
