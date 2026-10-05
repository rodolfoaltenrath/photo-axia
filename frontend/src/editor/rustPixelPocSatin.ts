import { RustPixelPocError } from './rustPixelPocError.ts'
import { alphaMaskLayout } from './rustPixelPocAlphaMask.ts'
import { encodeDropShadow } from './rustPixelPocDropShadow.ts'
import type { RustPixelPocRegion } from './rustPixelPocRuntime.ts'
import type { LayerBlendMode, LayerStyleContour, SatinEffect } from '../types/editor.ts'

export interface RustPixelPocSatin {
  radius: number
  offsetX: number
  offsetY: number
  invert: boolean
  color: [number, number, number, number]
  opacity: number
  blendMode: LayerBlendMode
  contour: LayerStyleContour
}

export function prepareRustSatin(effect: SatinEffect, scale: number): RustPixelPocSatin {
  if (!effect || effect.type !== 'satin' || typeof effect.id !== 'string' || !effect.id.length || effect.id.length > 128 ||
      !Number.isFinite(scale) || scale <= 0 || scale > 8 ||
      !Number.isFinite(effect.size) || effect.size < 0 || effect.size > 250 ||
      !Number.isFinite(effect.distance) || effect.distance < 0 || effect.distance > 1000 ||
      !Number.isFinite(effect.angle) || effect.angle < -180 || effect.angle >= 180 ||
      !/^#[\da-f]{6}([\da-f]{2})?$/i.test(effect.color)) throw new RustPixelPocError('invalid-input')
  const radians = effect.angle * Math.PI / 180, distance = effect.distance * scale
  const satin: RustPixelPocSatin = { radius: Math.round(effect.size * scale),
    offsetX: Math.round(Math.cos(radians) * distance), offsetY: Math.round(-Math.sin(radians) * distance),
    invert: effect.invert, opacity: effect.opacity, blendMode: effect.blendMode, contour: effect.contour,
    color: [Number.parseInt(effect.color.slice(1, 3), 16), Number.parseInt(effect.color.slice(3, 5), 16),
      Number.parseInt(effect.color.slice(5, 7), 16), effect.color.length === 9 ? Number.parseInt(effect.color.slice(7, 9), 16) : 255] }
  encodeSatin(satin)
  return satin
}

export function encodeSatin(satin: RustPixelPocSatin) {
  if (!satin || typeof satin.invert !== 'boolean') throw new RustPixelPocError('invalid-input')
  const packet = encodeDropShadow({ spreadRadius: 0, blurRadius: satin.radius, offsetX: satin.offsetX, offsetY: satin.offsetY,
    color: satin.color, opacity: satin.opacity, blendMode: satin.blendMode, contour: satin.contour,
    seed: 0, noise: 0, knockout: false })
  const view = new DataView(packet.buffer)
  view.setUint32(0, 0x31544153, true); view.setUint32(8, satin.radius, true); view.setUint32(12, satin.invert ? 1 : 0, true)
  return packet
}

export function satinLayout(width: number, height: number, region: RustPixelPocRegion,
  satin: RustPixelPocSatin, packetLength: number) {
  if (!Number.isSafeInteger(packetLength) || packetLength < 64 || packetLength > 576 || packetLength % 8 !== 0) {
    throw new RustPixelPocError('invalid-input')
  }
  const config = { spreadRadius: 0, blurRadius: satin.radius, precise: false }
  const extra = region.width * region.height * 4 + packetLength + 512
  const { context } = alphaMaskLayout(width, height, region, config, extra)
  // The first mask stays alive during the second blur.
  return alphaMaskLayout(width, height, region, config, extra + context.width * context.height)
}
