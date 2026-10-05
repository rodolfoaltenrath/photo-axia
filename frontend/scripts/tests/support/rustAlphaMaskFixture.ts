import { spreadAlpha, blurAlpha } from '../../../src/editor/layerStyleRaster.ts'
import type { RustPixelPocAlphaMask } from '../../../src/editor/rustPixelPocAlphaMask.ts'

export function alphaMaskReference(source: Uint8Array, width: number, height: number, config: RustPixelPocAlphaMask) {
  const mask = new Uint8ClampedArray(width * height)
  for (let index = 0; index < mask.length; index++) mask[index] = source[index * 4 + 3]!
  const filtered = blurAlpha(spreadAlpha(mask, width, height, config.spreadRadius), width, height, config.blurRadius, config.precise)
  const rgba = new Uint8Array(source.length)
  for (let index = 0; index < mask.length; index++) rgba[index * 4 + 3] = filtered[index]!
  return rgba
}
