import { RustPixelPocError } from './rustPixelPocError.ts'
import type { RustPixelPocBlendIf, RustPixelPocColorOverlay, RustPixelPocGradientOverlay,
  RustPixelPocPatternOverlay, RustPixelPocPatternRaster } from './rustPixelPocRuntime.ts'

export const RUST_BATCH_JOB_BYTES = 96 * 1024 * 1024
export const RUST_BATCH_EFFECTS = 64
const modes = { normal: 0, multiply: 1, screen: 2, overlay: 3, darken: 4, lighten: 5 } as const
const gradients = { linear: 0, reflected: 1, diamond: 2, radial: 3, angle: 4 } as const
const channels = { gray: 0, red: 1, green: 2, blue: 3 } as const

export type RustPixelPocBatchEffect =
  | { type: 'color-overlay'; effect: RustPixelPocColorOverlay }
  | { type: 'gradient-overlay'; effect: RustPixelPocGradientOverlay }
  | { type: 'pattern-overlay'; effect: RustPixelPocPatternOverlay; pattern: RustPixelPocPatternRaster }
export interface RustPixelPocBatchPlan {
  fillOpacity: number
  effects: RustPixelPocBatchEffect[]
  thisLayerBlendIf?: RustPixelPocBlendIf
}

function invalid(): never { throw new RustPixelPocError('invalid-input') }
function percent(value: number) { if (!Number.isFinite(value) || value < 0 || value > 100) invalid() }
function angle(value: number) { if (!Number.isFinite(value) || value < -180 || value >= 180) invalid() }
function rgba(value: number[]) {
  if (!Array.isArray(value) || value.length !== 4 || [...value].some(byte => !Number.isSafeInteger(byte) || byte < 0 || byte > 255)) invalid()
}
function overlay(effect: RustPixelPocColorOverlay | RustPixelPocGradientOverlay | RustPixelPocPatternOverlay) {
  if (!effect || !Object.hasOwn(modes, effect.blendMode)) invalid()
  percent(effect.opacity)
}

export function validateBatchBlendIf(config: RustPixelPocBlendIf) {
  if (!config || !Object.hasOwn(channels, config.channel) || !Array.isArray(config.shadows) ||
      config.shadows.length !== 2 || !Array.isArray(config.highlights) || config.highlights.length !== 2) invalid()
  const values = [...config.shadows, ...config.highlights]
  if (values.some((value, index) => !Number.isSafeInteger(value) || value < 0 || value > 255 ||
      (index > 0 && value < values[index - 1]!))) invalid()
}

export function encodeBatchGradient(effect: RustPixelPocGradientOverlay) {
  overlay(effect)
  if (!effect.gradient || !Object.hasOwn(gradients, effect.gradient.type) || typeof effect.reverse !== 'boolean' ||
      !Number.isFinite(effect.scale) || effect.scale < 1 || effect.scale > 1000) invalid()
  angle(effect.angle)
  const { colorStops, opacityStops } = effect.gradient
  for (const stops of [colorStops, opacityStops]) {
    if (!Array.isArray(stops) || stops.length < 2 || stops.length > 32) invalid()
    let previous = 0
    for (const stop of stops) {
      if (!stop || !Number.isFinite(stop.position) || stop.position < previous || stop.position > 1) invalid()
      previous = stop.position
    }
  }
  const colors = new Uint8Array(colorStops.length * 16), opacities = new Uint8Array(opacityStops.length * 16)
  const colorView = new DataView(colors.buffer), opacityView = new DataView(opacities.buffer)
  for (const [index, stop] of colorStops.entries()) {
    rgba(stop.color)
    colorView.setFloat64(index * 16, stop.position, true)
    colors.set(stop.color, index * 16 + 8)
  }
  for (const [index, stop] of opacityStops.entries()) {
    percent(stop.opacity)
    opacityView.setFloat64(index * 16, stop.position, true)
    opacityView.setFloat64(index * 16 + 8, stop.opacity, true)
  }
  const radians = effect.angle * Math.PI / 180
  return { colors, opacities, radians, cosine: Math.cos(radians), sine: Math.sin(radians) }
}

function prepareLocalBatch(plan: RustPixelPocBatchPlan) {
  if (!plan || !Array.isArray(plan.effects) || plan.effects.length > RUST_BATCH_EFFECTS) invalid()
  percent(plan.fillOpacity)
  if (plan.thisLayerBlendIf !== undefined) validateBatchBlendIf(plan.thisLayerBlendIf)
  const prepared = [] as { pass: RustPixelPocBatchEffect; payloads: Uint8Array[]; params: number[] }[]
  let length = 32 + plan.effects.length * 96
  for (const pass of plan.effects) {
    if (!pass) invalid()
    overlay(pass.effect)
    let payloads: Uint8Array[] = [], params: number[] = []
    switch (pass.type) {
      case 'color-overlay': rgba(pass.effect.color); break
      case 'gradient-overlay': {
        const gradient = encodeBatchGradient(pass.effect)
        payloads = [gradient.colors, gradient.opacities]
        params = [gradient.radians, gradient.cosine, gradient.sine, pass.effect.scale]
        break
      }
      case 'pattern-overlay': {
        angle(pass.effect.angle)
        if (!Number.isFinite(pass.effect.scale) || pass.effect.scale < 1 || pass.effect.scale > 1000) invalid()
        const pattern = pass.pattern
        if (!pattern || !(pattern.rgba instanceof Uint8Array) || !Number.isSafeInteger(pattern.width) ||
            !Number.isSafeInteger(pattern.height) || pattern.width < 1 || pattern.height < 1 ||
            pattern.width > 8192 || pattern.height > 8192 || pattern.rgba.byteLength !== pattern.width * pattern.height * 4 ||
            pattern.rgba.byteLength > 64 * 1024 * 1024) invalid()
        const radians = -pass.effect.angle * Math.PI / 180
        params = [0, Math.cos(radians), Math.sin(radians), Math.max(0.01, pass.effect.scale / 100)]
        payloads = [pattern.rgba]
        break
      }
      default: pass satisfies never; invalid()
    }
    for (const bytes of payloads) length += Math.ceil(bytes.byteLength / 8) * 8
    prepared.push({ pass, payloads, params })
  }
  return { prepared, length }
}

export function localBatchPacketLength(plan: RustPixelPocBatchPlan) { return prepareLocalBatch(plan).length }

export function encodeLocalBatch(plan: RustPixelPocBatchPlan, sourceBytes: number, tileBytes: number) {
  if ([sourceBytes, tileBytes].some(bytes => !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > 64 * 1024 * 1024 || bytes % 4 !== 0)) invalid()
  const { prepared, length } = prepareLocalBatch(plan)
  const scratchCount = prepared.length || plan.thisLayerBlendIf !== undefined ? 2 : 1
  const total = sourceBytes + tileBytes * (1 + scratchCount) + length + prepared.length * 2048
  if (length > 64 * 1024 * 1024 || total > RUST_BATCH_JOB_BYTES) throw new RustPixelPocError('memory-limit')
  const packet = new Uint8Array(length), view = new DataView(packet.buffer)
  view.setUint32(0, 0x31425841, true); view.setUint32(4, 1, true); view.setUint32(8, prepared.length, true)
  view.setFloat64(16, plan.fillOpacity, true)
  if (plan.thisLayerBlendIf !== undefined) {
    packet.set([...plan.thisLayerBlendIf.shadows, ...plan.thisLayerBlendIf.highlights], 12)
    view.setUint32(24, 1, true); view.setUint32(28, channels[plan.thisLayerBlendIf.channel], true)
  }
  let payloadOffset = 32 + prepared.length * 96
  for (const [index, { pass, payloads, params }] of prepared.entries()) {
    const offset = 32 + index * 96
    view.setUint32(offset, pass.type === 'color-overlay' ? 1 : pass.type === 'gradient-overlay' ? 2 : 3, true)
    view.setUint32(offset + 4, modes[pass.effect.blendMode], true)
    view.setFloat64(offset + 8, pass.effect.opacity, true)
    for (const [parameter, value] of params.entries()) view.setFloat64(offset + 16 + parameter * 8, value, true)
    for (const [part, bytes] of payloads.entries()) {
      view.setUint32(offset + 56 + part * 8, payloadOffset, true)
      view.setUint32(offset + 60 + part * 8, bytes.byteLength, true)
      packet.set(bytes, payloadOffset); payloadOffset += Math.ceil(bytes.byteLength / 8) * 8
    }
    switch (pass.type) {
      case 'color-overlay': packet.set(pass.effect.color, offset + 52); break
      case 'gradient-overlay':
        view.setUint32(offset + 48, pass.effect.reverse ? 1 : 0, true)
        view.setUint32(offset + 72, gradients[pass.effect.gradient.type], true)
        break
      case 'pattern-overlay':
        view.setUint32(offset + 72, pass.pattern.width, true); view.setUint32(offset + 76, pass.pattern.height, true)
        break
      default: pass satisfies never; invalid()
    }
  }
  return packet
}
