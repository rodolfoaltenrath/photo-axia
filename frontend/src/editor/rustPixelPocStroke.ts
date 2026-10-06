import { RustPixelPocError } from './rustPixelPocError.ts'
import { alphaMaskLayout } from './rustPixelPocAlphaMask.ts'
import { encodeBatchGradient } from './rustPixelPocBatch.ts'
import type { RustPixelPocGradientOverlay, RustPixelPocPatternOverlay, RustPixelPocPatternRaster, RustPixelPocRegion } from './rustPixelPocRuntime.ts'
import type { LayerBlendMode, StrokeEffect } from '../types/editor.ts'

const modes = { normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5 } as const
const gradients = { linear: 0, reflected: 1, diamond: 2, radial: 3, angle: 4 } as const
export interface RustPixelPocStroke {
  outsideRadius: number
  insideRadius: number
  opacity: number
  blendMode: LayerBlendMode
  paint: { type: 'color'; color: [number, number, number, number] }
    | ({ type: 'gradient' } & Omit<RustPixelPocGradientOverlay, 'opacity' | 'blendMode'>)
    | { type: 'pattern'; pattern: RustPixelPocPatternRaster; angle: number; scale: number }
    | { type: 'missing-pattern' }
}
function invalid(): never { throw new RustPixelPocError('invalid-input') }
function decodeColor(value: string): [number, number, number, number] {
  if (typeof value !== 'string' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) invalid()
  return [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16), value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) : 255]
}

export function prepareRustStroke(effect: StrokeEffect, scale: number, pattern?: RustPixelPocPatternRaster): RustPixelPocStroke {
  if (!effect || effect.type !== 'stroke' || typeof effect.id !== 'string' || !effect.id.length || effect.id.length > 128 ||
      !Number.isFinite(scale) || scale <= 0 || scale > 8 || !Number.isFinite(effect.size) || effect.size < 1 || effect.size > 250 ||
      !['inside', 'center', 'outside'].includes(effect.position) || !effect.paint) invalid()
  const thickness = Math.max(1, Math.round(effect.size * scale))
  let paint: RustPixelPocStroke['paint']
  switch (effect.paint.type) {
    case 'color': paint = { type: 'color', color: decodeColor(effect.paint.color) }; break
    case 'gradient': {
      const value = effect.paint
      if (!value.gradient || !Array.isArray(value.gradient.colorStops) || !Array.isArray(value.gradient.opacityStops) ||
          value.gradient.colorStops.length < 2 || value.gradient.colorStops.length > 32 ||
          value.gradient.opacityStops.length < 2 || value.gradient.opacityStops.length > 32 || typeof value.alignWithLayer !== 'boolean') invalid()
      paint = { type: 'gradient', angle: value.angle, scale: value.scale, reverse: value.reverse, gradient: {
        type: value.gradient.type, colorStops: value.gradient.colorStops.map(stop => {
          if (!stop) invalid()
          return { position: stop.position, color: decodeColor(stop.color) }
        }), opacityStops: value.gradient.opacityStops.map(stop => {
          if (!stop) invalid()
          return { position: stop.position, opacity: stop.opacity }
        }) } }; break
    }
    case 'pattern':
      if (typeof effect.paint.linkWithLayer !== 'boolean') invalid()
      if (!effect.paint.pattern) paint = { type: 'missing-pattern' }
      else {
        if (!pattern) invalid()
        paint = { type: 'pattern', pattern, angle: effect.paint.angle, scale: effect.paint.scale }
      }
      break
    default: effect.paint satisfies never; invalid()
  }
  const stroke: RustPixelPocStroke = { outsideRadius: effect.position === 'outside' ? thickness : effect.position === 'center' ? Math.ceil(thickness / 2) : 0,
    insideRadius: effect.position === 'inside' ? thickness : effect.position === 'center' ? Math.floor(thickness / 2) : 0,
    opacity: effect.opacity, blendMode: effect.blendMode, paint }
  strokePacketLength(stroke)
  return stroke
}

function preparePacket(stroke: RustPixelPocStroke) {
  if (!stroke || !Object.hasOwn(modes, stroke.blendMode) || !stroke.paint || !Number.isFinite(stroke.opacity) || stroke.opacity < 0 || stroke.opacity > 100 ||
      [stroke.outsideRadius, stroke.insideRadius].some(value => !Number.isSafeInteger(value) || value < 0 || value > 4096) ||
      stroke.outsideRadius + stroke.insideRadius < 1 || stroke.outsideRadius + stroke.insideRadius > 4096) invalid()
  let payloads: Uint8Array[] = [], kind = 0, color: [number, number, number, number] = [0, 0, 0, 0]
  let radians = 0, cosine = 1, sine = 0, scale = 1, colorCount = 0, opacityCount = 0, gradientKind = 0, reverse = false, patternWidth = 0, patternHeight = 0
  switch (stroke.paint.type) {
    case 'color':
      if (!Array.isArray(stroke.paint.color) || stroke.paint.color.length !== 4 || [...stroke.paint.color].some(value =>
          !Number.isSafeInteger(value) || value < 0 || value > 255)) invalid()
      color = stroke.paint.color; break
    case 'gradient': {
      const gradient = encodeBatchGradient({ ...stroke.paint, opacity: 100, blendMode: 'normal' })
      payloads = [gradient.colors, gradient.opacities]; kind = 1
      radians = gradient.radians; cosine = gradient.cosine; sine = gradient.sine; scale = stroke.paint.scale
      reverse = stroke.paint.reverse; gradientKind = gradients[stroke.paint.gradient.type]
      colorCount = gradient.colors.length / 16; opacityCount = gradient.opacities.length / 16
      break
    }
    case 'pattern': {
      const value: RustPixelPocPatternOverlay = { ...stroke.paint, opacity: 100, blendMode: 'normal' }, pattern = stroke.paint.pattern
      if (!Number.isFinite(value.angle) || value.angle < -180 || value.angle >= 180 || !Number.isFinite(value.scale) || value.scale < 1 || value.scale > 1000 ||
          !pattern || !(pattern.rgba instanceof Uint8Array) || !Number.isSafeInteger(pattern.width) || !Number.isSafeInteger(pattern.height) ||
          pattern.width < 1 || pattern.height < 1 || pattern.width > 8192 || pattern.height > 8192 || pattern.rgba.byteLength !== pattern.width * pattern.height * 4 ||
          pattern.rgba.byteLength > 64 * 1024 * 1024) invalid()
      const angle = -value.angle * Math.PI / 180
      kind = 2; cosine = Math.cos(angle); sine = Math.sin(angle); scale = Math.max(0.01, value.scale / 100)
      patternWidth = pattern.width; patternHeight = pattern.height; payloads = [pattern.rgba]
      break
    }
    case 'missing-pattern': kind = 3; break
    default: stroke.paint satisfies never; invalid()
  }
  const length = 96 + payloads.reduce((sum, bytes) => sum + bytes.length, 0)
  if (length > 64 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
  return { payloads, kind, color, radians, cosine, sine, scale, colorCount, opacityCount, gradientKind, reverse, patternWidth, patternHeight, length }
}

export function strokePacketLength(stroke: RustPixelPocStroke) { return preparePacket(stroke).length }

export function encodeStroke(stroke: RustPixelPocStroke) {
  const config = preparePacket(stroke), packet = new Uint8Array(config.length), view = new DataView(packet.buffer)
  view.setUint32(0, 0x314b5453, true); view.setUint32(4, 1, true)
  view.setUint32(8, stroke.outsideRadius, true); view.setUint32(12, stroke.insideRadius, true)
  view.setUint32(16, config.kind, true); view.setUint32(20, modes[stroke.blendMode], true); packet.set(config.color, 24)
  view.setUint32(28, config.gradientKind, true); view.setUint32(32, config.reverse ? 1 : 0, true)
  view.setUint32(36, config.colorCount, true); view.setUint32(40, config.opacityCount, true)
  view.setUint32(44, config.patternWidth, true); view.setUint32(48, config.patternHeight, true)
  view.setUint32(52, config.kind === 2 ? config.payloads[0]!.length : 0, true)
  view.setFloat64(56, stroke.opacity, true); view.setFloat64(64, config.cosine, true); view.setFloat64(72, config.sine, true)
  view.setFloat64(80, config.scale, true); view.setFloat64(88, config.radians, true)
  let offset = 96
  for (const bytes of config.payloads) { packet.set(bytes, offset); offset += bytes.length }
  return packet
}

export function strokeLayout(width: number, height: number, region: RustPixelPocRegion, stroke: RustPixelPocStroke, packetLength: number) {
  if (!Number.isSafeInteger(packetLength) || packetLength < 96 || packetLength > 64 * 1024 * 1024) invalid()
  const missing = stroke.paint.type === 'missing-pattern'
  const halo = missing ? 0 : Math.max(stroke.outsideRadius, stroke.insideRadius)
  const layout = alphaMaskLayout(width, height, region, { spreadRadius: 0, blurRadius: halo, precise: false })
  if (!missing && stroke.outsideRadius > 0 && width * width + height * height + 1 > 0x7fffffff) invalid()
  const { context } = layout, pixels = context.width * context.height, axis = Math.max(context.width, context.height)
  const maskBytes = missing ? 0 : pixels * 3
  const distanceBytes = !missing && stroke.outsideRadius > 0 ? pixels * 4 + axis * 20 + 8 : 0
  const queueBytes = !missing && stroke.insideRadius > 0 ? (axis + stroke.insideRadius * 2) * 4 : 0
  const workingBytes = width * height * 4 + region.width * region.height * 8 + packetLength + 2048 + maskBytes + distanceBytes + queueBytes
  if (workingBytes > 96 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
  return { context, halo, workingBytes }
}
