import { RustPixelPocError } from './rustPixelPocError.ts'
import { alphaMaskLayout } from './rustPixelPocAlphaMask.ts'
import { encodeDropShadow, prepareRustShadowParameters, type RustPixelPocDropShadow } from './rustPixelPocDropShadow.ts'
import type { RustPixelPocRegion } from './rustPixelPocRuntime.ts'
import type { InnerShadowEffect, LayerStyleGlobalLight } from '../types/editor.ts'

export interface RustPixelPocInnerShadow extends Omit<RustPixelPocDropShadow, 'spreadRadius' | 'knockout'> { choke: number }

export function prepareRustInnerShadow(effect: InnerShadowEffect, light: LayerStyleGlobalLight,
  scale: number): RustPixelPocInnerShadow {
  if (!effect || effect.type !== 'inner-shadow') throw new RustPixelPocError('invalid-input')
  const { spreadRadius: _spread, knockout: _knockout, ...common } = prepareRustShadowParameters(effect, light, scale)
  const shadow = { ...common, choke: effect.choke }
  encodeInnerShadow(shadow)
  return shadow
}

export function encodeInnerShadow(shadow: RustPixelPocInnerShadow) {
  if (!shadow || !Number.isFinite(shadow.choke) || shadow.choke < 0 || shadow.choke > 100) {
    throw new RustPixelPocError('invalid-input')
  }
  const common = encodeDropShadow({ ...shadow, spreadRadius: 0, knockout: false })
  const packet = new Uint8Array(common.length + 8), view = new DataView(packet.buffer)
  packet.set(common.subarray(0, 64)); packet.set(common.subarray(64), 72)
  view.setUint32(0, 0x31494853, true); view.setFloat64(64, shadow.choke, true)
  return packet
}

export function innerShadowLayout(width: number, height: number, region: RustPixelPocRegion,
  shadow: RustPixelPocInnerShadow, packetLength: number) {
  if (!Number.isSafeInteger(packetLength) || packetLength < 72 || packetLength > 584 || packetLength % 8 !== 0) {
    throw new RustPixelPocError('invalid-input')
  }
  return alphaMaskLayout(width, height, region, { spreadRadius: 0, blurRadius: shadow.blurRadius, precise: false },
    region.width * region.height * 4 + packetLength + 512)
}
