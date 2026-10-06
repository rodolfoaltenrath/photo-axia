import { RustPixelPocError } from './rustPixelPocError.ts'
import { alphaMaskLayout } from './rustPixelPocAlphaMask.ts'
import { encodeDropShadow } from './rustPixelPocDropShadow.ts'
import type { RustPixelPocPatternRaster, RustPixelPocRegion } from './rustPixelPocRuntime.ts'
import type { BevelEmbossEffect, LayerBlendMode, LayerStyleContour, LayerStyleGlobalLight } from '../types/editor.ts'

const modes = { normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5 } as const
const techniques = { smooth: 0, 'chisel-hard': 1, 'chisel-soft': 2 } as const
const styles = { 'inner-bevel': 0, 'outer-bevel': 1, emboss: 2, 'pillow-emboss': 3 } as const
export interface RustPixelPocBevel {
  radius: number
  softenRadius: number
  technique: BevelEmbossEffect['technique']
  style: BevelEmbossEffect['style']
  direction: BevelEmbossEffect['direction']
  opacity: number
  strength: number
  light: [number, number, number]
  highlightMode: LayerBlendMode
  shadowMode: LayerBlendMode
  highlightColor: [number, number, number, number]
  shadowColor: [number, number, number, number]
  highlightOpacity: number
  shadowOpacity: number
  glossContour: LayerStyleContour
  contourEnabled: boolean
  contour: LayerStyleContour
  contourRange: number
  texture?: RustPixelPocPatternRaster
  textureScaleFactor: number
  textureDepthFactor: number
  textureInvert: boolean
}
function invalid(): never { throw new RustPixelPocError('invalid-input') }
function color(value: string): [number, number, number, number] {
  if (typeof value !== 'string' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(value)) invalid()
  return [Number.parseInt(value.slice(1, 3), 16), Number.parseInt(value.slice(3, 5), 16),
    Number.parseInt(value.slice(5, 7), 16), value.length === 9 ? Number.parseInt(value.slice(7, 9), 16) : 255]
}
export function prepareRustBevel(effect: BevelEmbossEffect, light: LayerStyleGlobalLight, scale: number,
  texture?: RustPixelPocPatternRaster): RustPixelPocBevel {
  if (!effect || effect.type !== 'bevel-emboss' || !light || typeof effect.id !== 'string' || !effect.id.length || effect.id.length > 128 ||
      !Number.isFinite(scale) || scale <= 0 || scale > 8 ||
      [effect.size, effect.soften].some(v => !Number.isFinite(v) || v < 0 || v > 250) ||
      !Number.isFinite(effect.depth) || effect.depth < 1 || effect.depth > 1000 ||
      !Number.isFinite(effect.altitude) || effect.altitude < 0 || effect.altitude > 90 ||
      typeof effect.useGlobalLight !== 'boolean' || typeof effect.textureEnabled !== 'boolean' ||
      typeof effect.textureInvert !== 'boolean' || typeof effect.textureLinkWithLayer !== 'boolean' ||
      !Number.isFinite(effect.textureScale) || effect.textureScale < 1 || effect.textureScale > 1000 ||
      !Number.isFinite(effect.textureDepth) || effect.textureDepth < -1000 || effect.textureDepth > 1000) invalid()
  const angle = effect.useGlobalLight ? light.angle : effect.angle
  if (!Number.isFinite(angle) || angle < -180 || angle >= 180) invalid()
  if (effect.textureEnabled && effect.texture && !texture) invalid()
  const activeTexture = effect.textureEnabled && effect.texture ? texture : undefined
  // The current renderer uses global angle, but the effect's own altitude.
  const radians = angle * Math.PI / 180, altitude = effect.altitude * Math.PI / 180
  const bevel: RustPixelPocBevel = { radius: Math.max(1, Math.round(effect.size * scale)), softenRadius: Math.round(effect.soften * scale),
    technique: effect.technique, style: effect.style, direction: effect.direction, opacity: effect.opacity, strength: effect.depth / 100 * 4,
    light: [Math.cos(radians) * Math.cos(altitude), -Math.sin(radians) * Math.cos(altitude), Math.sin(altitude)],
    highlightMode: effect.highlightMode, shadowMode: effect.shadowMode, highlightColor: color(effect.highlightColor), shadowColor: color(effect.shadowColor),
    highlightOpacity: effect.highlightOpacity, shadowOpacity: effect.shadowOpacity, glossContour: effect.glossContour,
    contourEnabled: effect.contourEnabled, contour: effect.contour, contourRange: effect.contourRange, texture: activeTexture,
    textureScaleFactor: activeTexture ? Math.max(0.01, effect.textureScale / 100) : 1,
    textureDepthFactor: activeTexture ? effect.textureDepth / 100 : 0, textureInvert: activeTexture ? effect.textureInvert : false }
  bevelPacketLength(bevel)
  return bevel
}
function contourPacket(contour: LayerStyleContour) {
  return encodeDropShadow({ spreadRadius: 0, blurRadius: 0, offsetX: 0, offsetY: 0, color: [0, 0, 0, 0],
    opacity: 100, blendMode: 'normal', noise: 0, seed: 0, knockout: false, contour })
}
function preparePacket(bevel: RustPixelPocBevel) {
  if (!bevel || !Object.hasOwn(techniques, bevel.technique) || !Object.hasOwn(styles, bevel.style) ||
      !['up', 'down'].includes(bevel.direction) || typeof bevel.contourEnabled !== 'boolean' || typeof bevel.textureInvert !== 'boolean' ||
      !Object.hasOwn(modes, bevel.highlightMode) || !Object.hasOwn(modes, bevel.shadowMode) ||
      [bevel.radius, bevel.softenRadius].some(v => !Number.isSafeInteger(v) || v < 0 || v > 4096) || bevel.radius < 1 || bevel.radius + bevel.softenRadius > 4096 ||
      [bevel.opacity, bevel.highlightOpacity, bevel.shadowOpacity].some(v => !Number.isFinite(v) || v < 0 || v > 100) ||
      [bevel.highlightColor, bevel.shadowColor].some(c => !Array.isArray(c) || c.length !== 4 || c.some(v => !Number.isSafeInteger(v) || v < 0 || v > 255)) ||
      !Number.isFinite(bevel.strength) || bevel.strength < 0.04 || bevel.strength > 40 ||
      !Array.isArray(bevel.light) || bevel.light.length !== 3 || bevel.light.some(v => !Number.isFinite(v) || Math.abs(v) > 1) || bevel.light[2] < 0 ||
      Math.abs(bevel.light[0] ** 2 + bevel.light[1] ** 2 + bevel.light[2] ** 2 - 1) > 1e-12 ||
      !Number.isFinite(bevel.contourRange) || bevel.contourRange < 1 || bevel.contourRange > 100 ||
      !Number.isFinite(bevel.textureScaleFactor) || bevel.textureScaleFactor < 0.01 || bevel.textureScaleFactor > 10 ||
      !Number.isFinite(bevel.textureDepthFactor) || bevel.textureDepthFactor < -10 || bevel.textureDepthFactor > 10) invalid()
  const texture = bevel.texture
  if (texture) {
    if (!(texture.rgba instanceof Uint8Array) || !Number.isSafeInteger(texture.width) || !Number.isSafeInteger(texture.height) ||
        texture.width < 1 || texture.height < 1 || texture.width > 8192 || texture.height > 8192 ||
        texture.rgba.byteLength !== texture.width * texture.height * 4 || texture.rgba.byteLength > 64 * 1024 * 1024) invalid()
  } else if (bevel.textureInvert || bevel.textureScaleFactor !== 1 || bevel.textureDepthFactor !== 0) invalid()
  const gloss = contourPacket(bevel.glossContour), contour = contourPacket(bevel.contour)
  const length = 160 + gloss.length - 64 + contour.length - 64 + (texture?.rgba.length ?? 0)
  if (length > 64 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
  return { gloss, contour, length }
}
export function bevelPacketLength(bevel: RustPixelPocBevel) { return preparePacket(bevel).length }
export function encodeBevel(bevel: RustPixelPocBevel) {
  const { gloss, contour, length } = preparePacket(bevel), packet = new Uint8Array(length), view = new DataView(packet.buffer)
  view.setUint32(0, 0x31564542, true); view.setUint32(4, 1, true)
  view.setUint32(8, bevel.radius, true); view.setUint32(12, bevel.softenRadius, true)
  view.setUint32(16, techniques[bevel.technique], true); view.setUint32(20, styles[bevel.style], true)
  view.setUint32(24, bevel.direction === 'down' ? 1 : 0, true); view.setUint32(28, bevel.contourEnabled ? 1 : 0, true)
  view.setUint32(32, modes[bevel.highlightMode], true); view.setUint32(36, modes[bevel.shadowMode], true)
  packet.set(bevel.highlightColor, 40); packet.set(bevel.shadowColor, 44)
  for (const [bytes, offset] of [[gloss, 48], [contour, 56]] as const) {
    const data = new DataView(bytes.buffer)
    view.setUint32(offset, data.getUint32(36, true), true); view.setUint32(offset + 4, data.getUint32(44, true), true)
  }
  view.setUint32(64, bevel.texture?.width ?? 0, true); view.setUint32(68, bevel.texture?.height ?? 0, true)
  view.setUint32(72, bevel.texture?.rgba.length ?? 0, true); view.setUint32(76, bevel.textureInvert ? 1 : 0, true)
  for (const [offset, value] of [[80, bevel.opacity], [88, bevel.strength], [96, bevel.light[0]], [104, bevel.light[1]], [112, bevel.light[2]],
    [120, bevel.highlightOpacity], [128, bevel.shadowOpacity], [136, bevel.contourRange], [144, bevel.textureScaleFactor], [152, bevel.textureDepthFactor]] as const) {
    view.setFloat64(offset, value, true)
  }
  packet.set(gloss.subarray(64), 160); packet.set(contour.subarray(64), 160 + gloss.length - 64)
  if (bevel.texture) packet.set(bevel.texture.rgba, 160 + gloss.length - 64 + contour.length - 64)
  return packet
}
export function bevelLayout(width: number, height: number, region: RustPixelPocRegion, bevel: RustPixelPocBevel, packetLength: number) {
  if (!Number.isSafeInteger(packetLength) || packetLength < 160 || packetLength > 64 * 1024 * 1024) invalid()
  alphaMaskLayout(width, height, region, { spreadRadius: 0, blurRadius: 0, precise: false })
  const halo = bevel.radius + bevel.softenRadius + 1
  const x = Math.max(0, region.x - halo), y = Math.max(0, region.y - halo)
  const context = { x, y, width: Math.min(width, region.x + region.width + halo) - x, height: Math.min(height, region.y + region.height + halo) - y }
  const workingBytes = width * height * 4 + region.width * region.height * 8 + packetLength + 1024 + context.width * context.height * 2
  if (workingBytes > 96 * 1024 * 1024) throw new RustPixelPocError('memory-limit')
  return { context, halo, workingBytes }
}
