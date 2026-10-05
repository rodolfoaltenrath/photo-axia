import { RustPixelPocError } from './rustPixelPocError.ts'
import { alphaMaskLayout } from './rustPixelPocAlphaMask.ts'
import type { RustPixelPocRegion } from './rustPixelPocRuntime.ts'
import type { DropShadowEffect, LayerBlendMode, LayerStyleContour, LayerStyleGlobalLight } from '../types/editor.ts'

const modes = { normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5 } as const
const contours = { linear: 0, cone: 1, 'inverted-cone': 2, gaussian: 3, ring: 4, custom: 5 } as const

export interface RustPixelPocDropShadow {
  spreadRadius: number
  blurRadius: number
  offsetX: number
  offsetY: number
  color: [number, number, number, number]
  opacity: number
  blendMode: LayerBlendMode
  noise: number
  seed: number
  knockout: boolean
  contour: LayerStyleContour
}

function invalid(): never { throw new RustPixelPocError('invalid-input') }
function percent(value: number) { if (!Number.isFinite(value) || value < 0 || value > 100) invalid() }

/** Resolve TS trig, rounding and UTF-16 hashing once per effect. */
export function prepareRustDropShadow(effect: DropShadowEffect, light: LayerStyleGlobalLight, scale: number): RustPixelPocDropShadow {
  if (!effect || effect.type !== 'drop-shadow' || !light || !Number.isFinite(scale) || scale <= 0 || scale > 8 ||
      typeof effect.id !== 'string' || !effect.id.length || effect.id.length > 128 ||
      !Number.isFinite(effect.size) || effect.size < 0 || effect.size > 250 ||
      !Number.isFinite(effect.distance) || effect.distance < 0 || effect.distance > 1000 ||
      typeof effect.useGlobalLight !== 'boolean' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(effect.color)) invalid()
  percent(effect.spread)
  const angle = effect.useGlobalLight ? light.angle : effect.angle
  if (!Number.isFinite(angle) || angle < -180 || angle >= 180) invalid()
  const radius = Math.max(0, Math.round(effect.size * scale))
  const spreadRadius = Math.min(radius, Math.round(radius * effect.spread / 100))
  const radians = angle * Math.PI / 180, distance = effect.distance * scale
  let seed = 0x811c9dc5
  for (let index = 0; index < effect.id.length; index++) seed = Math.imul(seed ^ effect.id.charCodeAt(index), 0x01000193)
  const color: [number, number, number, number] = [Number.parseInt(effect.color.slice(1, 3), 16),
    Number.parseInt(effect.color.slice(3, 5), 16), Number.parseInt(effect.color.slice(5, 7), 16),
    effect.color.length === 9 ? Number.parseInt(effect.color.slice(7, 9), 16) : 255]
  const shadow: RustPixelPocDropShadow = { spreadRadius, blurRadius: radius - spreadRadius,
    offsetX: Math.round(-Math.cos(radians) * distance), offsetY: Math.round(Math.sin(radians) * distance),
    color, opacity: effect.opacity, blendMode: effect.blendMode, noise: effect.noise,
    seed: seed >>> 0, knockout: effect.layerKnocksOutShadow, contour: effect.contour }
  encodeDropShadow(shadow)
  return shadow
}

export function encodeDropShadow(shadow: RustPixelPocDropShadow) {
  if (!shadow || !Object.hasOwn(modes, shadow.blendMode) || typeof shadow.knockout !== 'boolean' ||
      !shadow.contour || !Object.hasOwn(contours, shadow.contour.preset) ||
      [shadow.spreadRadius, shadow.blurRadius].some(value => !Number.isSafeInteger(value) || value < 0 || value > 4096) ||
      shadow.spreadRadius + shadow.blurRadius > 4096 ||
      [shadow.offsetX, shadow.offsetY].some(value => !Number.isSafeInteger(value) || value < -8192 || value > 8192) ||
      !Number.isSafeInteger(shadow.seed) || shadow.seed < 0 || shadow.seed > 0xffffffff ||
      !Array.isArray(shadow.color) || shadow.color.length !== 4 ||
      [...shadow.color].some(value => !Number.isSafeInteger(value) || value < 0 || value > 255)) invalid()
  percent(shadow.opacity); percent(shadow.noise)
  const points = shadow.contour.preset === 'custom' ? shadow.contour.points : []
  if (!Array.isArray(points) || (shadow.contour.preset === 'custom' && (points.length < 2 || points.length > 32))) invalid()
  let previous = 0
  for (const point of points) {
    if (!point || !Number.isFinite(point.x) || point.x < previous || point.x > 1 ||
        !Number.isFinite(point.y) || point.y < 0 || point.y > 1) invalid()
    previous = point.x
  }
  const packet = new Uint8Array(64 + points.length * 16), view = new DataView(packet.buffer)
  view.setUint32(0, 0x31444853, true); view.setUint32(4, 1, true)
  view.setUint32(8, shadow.spreadRadius, true); view.setUint32(12, shadow.blurRadius, true)
  view.setInt32(16, shadow.offsetX, true); view.setInt32(20, shadow.offsetY, true)
  view.setUint32(24, modes[shadow.blendMode], true); view.setUint32(28, shadow.knockout ? 1 : 0, true)
  packet.set(shadow.color, 32)
  view.setUint32(36, contours[shadow.contour.preset], true); view.setUint32(40, shadow.seed, true); view.setUint32(44, points.length, true)
  view.setFloat64(48, shadow.opacity, true); view.setFloat64(56, shadow.noise, true)
  for (const [index, point] of points.entries()) {
    view.setFloat64(64 + index * 16, point.x, true); view.setFloat64(72 + index * 16, point.y, true)
  }
  return packet
}

export function dropShadowLayout(width: number, height: number, region: RustPixelPocRegion,
  shadow: RustPixelPocDropShadow, packetLength: number) {
  if (!Number.isSafeInteger(packetLength) || packetLength < 64 || packetLength > 576 || packetLength % 8 !== 0) invalid()
  return alphaMaskLayout(width, height, region, { spreadRadius: shadow.spreadRadius,
    blurRadius: shadow.blurRadius, precise: false }, region.width * region.height * 4 + packetLength + 512)
}
