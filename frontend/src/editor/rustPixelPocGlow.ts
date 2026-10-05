import { RustPixelPocError } from './rustPixelPocError.ts'
import { alphaMaskLayout } from './rustPixelPocAlphaMask.ts'
import { encodeDropShadow } from './rustPixelPocDropShadow.ts'
import { encodeBatchGradient } from './rustPixelPocBatch.ts'
import type { RustPixelPocGradientOverlay, RustPixelPocRegion } from './rustPixelPocRuntime.ts'
import type { InnerGlowEffect, OuterGlowEffect, LayerBlendMode, LayerStyleContour } from '../types/editor.ts'

const kinds = { outer: 0, 'inner-edge': 1, 'inner-center': 2 } as const
const modes = { normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5 } as const
export type RustPixelPocGlowPaint = { type: 'color'; color: [number, number, number, number] }
  | { type: 'gradient'; gradient: RustPixelPocGradientOverlay['gradient']; reverse: boolean }
export interface RustPixelPocGlow {
  kind: keyof typeof kinds
  spreadRadius: number
  blurRadius: number
  precise: boolean
  choke: number
  range: number
  jitter: number
  opacity: number
  noise: number
  seed: number
  contour: LayerStyleContour
  blendMode: LayerBlendMode
  paint: RustPixelPocGlowPaint
}

function invalid(): never { throw new RustPixelPocError('invalid-input') }
function percent(value: number) { if (!Number.isFinite(value) || value < 0 || value > 100) invalid() }
function decodeColor(value: string): [number, number, number, number] {
  if (typeof value !== 'string' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) invalid()
  return [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16), value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) : 255]
}

export function prepareRustGlow(effect: InnerGlowEffect | OuterGlowEffect, scale: number): RustPixelPocGlow {
  if (!effect || !['inner-glow', 'outer-glow'].includes(effect.type) || !Number.isFinite(scale) || scale <= 0 || scale > 8 ||
      typeof effect.id !== 'string' || !effect.id.length || effect.id.length > 128 || !effect.paint ||
      !['softer', 'precise'].includes(effect.technique) || !Number.isFinite(effect.size) || effect.size < 0 || effect.size > 250) invalid()
  if (effect.type === 'inner-glow' && !['edge', 'center'].includes(effect.source)) invalid()
  if (effect.type === 'outer-glow') percent(effect.spread)
  let paint: RustPixelPocGlowPaint
  if (effect.paint.type === 'color') paint = { type: 'color', color: decodeColor(effect.paint.color) }
  else if (effect.paint.type === 'gradient') {
    const value = effect.paint
    if (!value.gradient || [value.gradient.colorStops, value.gradient.opacityStops].some(stops =>
          !Array.isArray(stops) || stops.length < 2 || stops.length > 32 || [...stops].some(stop => !stop)) ||
        typeof value.alignWithLayer !== 'boolean' || !Number.isFinite(value.angle) || value.angle < -180 || value.angle >= 180 ||
        !Number.isFinite(value.scale) || value.scale < 1 || value.scale > 1000) invalid()
    paint = { type: 'gradient', reverse: value.reverse, gradient: { type: value.gradient.type,
      colorStops: value.gradient.colorStops.map(stop => ({ position: stop.position, color: decodeColor(stop.color) })),
      opacityStops: value.gradient.opacityStops.map(stop => ({ position: stop.position, opacity: stop.opacity })) } }
  } else invalid()
  const radius = Math.max(0, Math.round(effect.size * scale))
  const spreadRadius = effect.type === 'outer-glow' ? Math.min(radius, Math.round(radius * effect.spread / 100)) : 0
  let seed = 0x811c9dc5
  for (let index = 0; index < effect.id.length; index++) seed = Math.imul(seed ^ effect.id.charCodeAt(index), 0x01000193)
  const glow: RustPixelPocGlow = { kind: effect.type === 'outer-glow' ? 'outer' : effect.source === 'edge' ? 'inner-edge' : 'inner-center',
    spreadRadius, blurRadius: radius - spreadRadius, precise: effect.technique === 'precise',
    choke: effect.type === 'inner-glow' ? effect.choke : 0, range: effect.range, jitter: effect.jitter,
    opacity: effect.opacity, noise: effect.noise, seed: seed >>> 0, contour: effect.contour, blendMode: effect.blendMode, paint }
  encodeGlow(glow)
  return glow
}

export function encodeGlow(glow: RustPixelPocGlow) {
  if (!glow || !Object.hasOwn(kinds, glow.kind) || typeof glow.precise !== 'boolean' || !glow.paint ||
      !Number.isFinite(glow.range) || glow.range < 1 || glow.range > 100 ||
      (glow.kind === 'outer' && glow.choke !== 0) || (glow.kind !== 'outer' && glow.spreadRadius !== 0)) invalid()
  percent(glow.choke); percent(glow.jitter)
  let colors = new Uint8Array(0), opacities = new Uint8Array(0), paintKind = 0
  let color: [number, number, number, number] = [0, 0, 0, 0]
  if (glow.paint.type === 'color') color = glow.paint.color
  else if (glow.paint.type === 'gradient') {
    const encoded = encodeBatchGradient({ gradient: glow.paint.gradient, reverse: glow.paint.reverse,
      angle: 0, scale: 100, opacity: 100, blendMode: 'normal' })
    colors = encoded.colors; opacities = encoded.opacities; paintKind = glow.paint.reverse ? 2 : 1
  } else invalid()
  const common = encodeDropShadow({ spreadRadius: glow.spreadRadius, blurRadius: glow.blurRadius,
    offsetX: 0, offsetY: 0, knockout: false, color, opacity: glow.opacity, noise: glow.noise,
    seed: glow.seed, contour: glow.contour, blendMode: glow.blendMode })
  const points = common.subarray(64), packet = new Uint8Array(96 + points.length + colors.length + opacities.length)
  const view = new DataView(packet.buffer)
  view.setUint32(0, 0x31574c47, true); view.setUint32(4, 1, true); view.setUint32(8, kinds[glow.kind], true)
  view.setUint32(12, glow.spreadRadius, true); view.setUint32(16, glow.blurRadius, true)
  view.setUint32(20, glow.precise ? 1 : 0, true); view.setUint32(24, modes[glow.blendMode], true)
  view.setUint32(28, paintKind, true); packet.set(color, 32); packet.set(common.subarray(36, 48), 36)
  view.setUint32(48, colors.length / 16, true); view.setUint32(52, opacities.length / 16, true)
  view.setFloat64(56, glow.opacity, true); view.setFloat64(64, glow.noise, true)
  view.setFloat64(72, glow.range, true); view.setFloat64(80, glow.jitter, true); view.setFloat64(88, glow.choke, true)
  packet.set(points, 96); packet.set(colors, 96 + points.length); packet.set(opacities, 96 + points.length + colors.length)
  return packet
}

export function glowLayout(width: number, height: number, region: RustPixelPocRegion, glow: RustPixelPocGlow, packetLength: number) {
  if (!Number.isSafeInteger(packetLength) || packetLength < 96 || packetLength > 1632 || packetLength % 8 !== 0) invalid()
  return alphaMaskLayout(width, height, region, { spreadRadius: glow.spreadRadius, blurRadius: glow.blurRadius, precise: glow.precise },
    region.width * region.height * 4 + packetLength + 2048)
}
