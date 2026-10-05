import { RustPixelPocError } from './rustPixelPocError.ts'
import type { RustPixelPocRegion } from './rustPixelPocRuntime.ts'

export interface RustPixelPocAlphaMask { spreadRadius: number; blurRadius: number; precise: boolean }
export const RUST_ALPHA_MASK_JOB_BYTES = 96 * 1024 * 1024

export function alphaMaskLayout(width: number, height: number, region: RustPixelPocRegion, config: RustPixelPocAlphaMask, extraBytes = 0) {
  const invalid = () => { throw new RustPixelPocError('invalid-input') }
  if (!Number.isSafeInteger(extraBytes) || extraBytes < 0 || extraBytes > RUST_ALPHA_MASK_JOB_BYTES) invalid()
  if (!config || [config.spreadRadius, config.blurRadius].some(radius =>
      !Number.isSafeInteger(radius) || radius < 0 || radius > 4096) || typeof config.precise !== 'boolean') invalid()
  if (![width, height, region?.x, region?.y, region?.width, region?.height].every(Number.isSafeInteger) ||
      width <= 0 || height <= 0 || width * height * 4 > 64 * 1024 * 1024 || region.x < 0 || region.y < 0 ||
      region.width <= 0 || region.height <= 0 || region.x + region.width > width || region.y + region.height > height) invalid()
  const halo = config.spreadRadius + config.blurRadius
  const x = Math.max(0, region.x - halo), y = Math.max(0, region.y - halo)
  const context = { x, y, width: Math.min(width, region.x + region.width + halo) - x,
    height: Math.min(height, region.y + region.height + halo) - y }
  const maskBytes = context.width * context.height * 2
  const queueBytes = config.spreadRadius > 0 ? Math.max(context.width, context.height) * 4 : 0
  const workingBytes = width * height * 4 + region.width * region.height * 4 + maskBytes + queueBytes + extraBytes
  if (workingBytes > RUST_ALPHA_MASK_JOB_BYTES) throw new RustPixelPocError('memory-limit')
  return { context, halo, workingBytes }
}
