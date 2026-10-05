import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeLocalBatch, type RustPixelPocBatchPlan } from '../../src/editor/rustPixelPocBatch.ts'
import { batchPlan, batchReference } from './support/rustBatchFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import type { LayerEffect } from '../../src/types/editor.ts'
import type { RustPixelPocBatchEffect } from '../../src/editor/rustPixelPocBatch.ts'

const wasm = Uint8Array.from(readFileSync(new URL(
  '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const invalid = (error: unknown) => error instanceof RustPixelPocError && error.code === 'invalid-input'

test('Lote reproduz os nove goldens locais compatíveis sem regenerar expectativas', async () => {
  const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  const runtime = await createRustPixelPocRuntime(wasm)
  const colorBytes = (color: string): [number, number, number, number] => [Number.parseInt(color.slice(1, 3), 16),
    Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16), color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) : 255]
  let generation = 0
  try {
    for (const fixture of corpus.rasterCases) {
      const styles = normalizeLayerStyleConfig(fixture.styles)
      if (!styles.effects.every(effect => ['color-overlay', 'gradient-overlay', 'pattern-overlay'].includes(effect.type))) continue
      const effects: RustPixelPocBatchEffect[] = styles.effects.map((effect: LayerEffect) => {
        switch (effect.type) {
          case 'color-overlay': return { type: effect.type, effect: { ...effect, color: colorBytes(effect.color) } }
          case 'gradient-overlay': return { type: effect.type, effect: { ...effect, gradient: { ...effect.gradient,
            colorStops: effect.gradient.colorStops.map(stop => ({ position: stop.position, color: colorBytes(stop.color) })) } } }
          case 'pattern-overlay': {
            assert.ok(effect.pattern)
            const pattern = fixture.patterns.find((asset: { id: string }) => asset.id === effect.pattern!.id)
            return { type: effect.type, effect, pattern: { width: pattern.width, height: pattern.height, rgba: new Uint8Array(pattern.rgba) } }
          }
          default: throw new Error('Fixture não local')
        }
      })
      const source = new Uint8Array(fixture.source.rgba), { width, height } = fixture.source
      const staged = runtime.stageSource(source, width, height, ++generation)
      const result = runtime.localBatchStagedRegion(staged.sourceId, { x: 0, y: 0, width, height },
        { fillOpacity: styles.fillOpacity, effects, thisLayerBlendIf: { channel: styles.blendIf.channel, ...styles.blendIf.thisLayer } })
      assert.deepEqual([...result.rgba], fixture.expected.rgba, fixture.id)
      assert.equal(fixture.expected.offsetX, 0); assert.equal(fixture.expected.offsetY, 0)
    }
    assert.equal(generation, 9)
  } finally { runtime.dispose() }
})

test('Lote fill fracionário → cor → gradiente → padrão → Esta camada concorda com TS nos cinco tipos', async () => {
  const width = 256, height = 256
  const source = new Uint8Array(width * height * 4)
  for (let alpha = 0; alpha <= 255; alpha++) for (let value = 0; value <= 255; value++) {
    source.set([value, (value * 31 + alpha) % 256, (value * 47 + 13) % 256, alpha], (alpha * width + value) * 4)
  }
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    for (const type of ['linear', 'reflected', 'diamond', 'radial', 'angle'] as const) {
      for (const fill of [0, 37.5, 100]) {
        const plan = structuredClone(batchPlan)
        plan.fillOpacity = fill
        const gradient = plan.effects[1]!
        assert.equal(gradient.type, 'gradient-overlay')
        gradient.effect.gradient.type = type
        const before = structuredClone({ source, plan })
        const actual = runtime.localBatchStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, plan)
        assert.deepEqual(actual.rgba, batchReference(source, width, height, plan), `${type}/${fill}`)
        assert.equal(actual.generation, 1)
        assert.deepEqual({ source, plan }, before)
      }
    }
  } finally { runtime.dispose() }
})

test('Lote preserva tiles, ordem variável, fonte original e filtro terminal', async () => {
  const width = 7, height = 5
  const source = Uint8Array.from({ length: width * height * 4 }, (_, index) => index * 19 % 256)
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const staged = runtime.stageSource(source, width, height, 1)
    for (const order of [[0, 1, 2], [2, 1, 0], [1, 0, 2, 0], [2, 2, 1]]) {
      for (const channel of ['gray', 'red', 'green', 'blue'] as const) {
        const plan: RustPixelPocBatchPlan = { ...structuredClone(batchPlan),
          effects: order.map(index => structuredClone(batchPlan.effects[index]!)),
          thisLayerBlendIf: { channel, shadows: [10, 70], highlights: [170, 230] } }
        const expected = batchReference(source, width, height, plan)
        const assembled = new Uint8Array(source.length)
        for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 3) {
          const region = { x, y, width: Math.min(3, width - x), height: Math.min(2, height - y) }
          const tile = runtime.localBatchStagedRegion(staged.sourceId, region, plan).rgba
          assert.deepEqual(tile, gradientTile(expected, width, region))
          for (let row = 0; row < region.height; row++) assembled.set(tile.subarray(row * region.width * 4, (row + 1) * region.width * 4),
            ((y + row) * width + x) * 4)
        }
        assert.deepEqual(assembled, expected)
      }
    }
    assert.deepEqual(runtime.renderStagedRegion(staged.sourceId, { x: 0, y: 0, width, height }, 100).rgba,
      batchReference(source, width, height, { fillOpacity: 100, effects: [] }))
  } finally { runtime.dispose() }
})

test('Fill sozinho, 64 efeitos e arredondamentos sequenciais não são fundidos', async () => {
  const source = new Uint8Array([77, 88, 99, 0, 40, 60, 80, 1, 40, 60, 80, 101, 40, 60, 80, 255])
  const runtime = await createRustPixelPocRuntime(wasm)
  const region = { x: 0, y: 0, width: 4, height: 1 }
  try {
    const staged = runtime.stageSource(source, 4, 1, 1)
    for (const fillOpacity of [0, 0.5, 37.5, 50, 100]) {
      for (const count of [0, 1, 2, 64]) {
        const plan: RustPixelPocBatchPlan = { fillOpacity, effects: Array.from({ length: count }, () => structuredClone(batchPlan.effects[0]!)) }
        assert.deepEqual(runtime.localBatchStagedRegion(staged.sourceId, region, plan).rgba, batchReference(source, 4, 1, plan))
      }
    }
    const plan: RustPixelPocBatchPlan = { fillOpacity: 50, effects: [],
      thisLayerBlendIf: { channel: 'red', shadows: [0, 80], highlights: [255, 255] } }
    const actual = runtime.localBatchStagedRegion(staged.sourceId, region, plan).rgba
    assert.equal(actual[7], 1)
    assert.deepEqual(actual, batchReference(source, 4, 1, plan))
  } finally { runtime.dispose() }
})

test('Adapter rejeita plano incompleto/efeito incompatível e orçamento antes de alocar o pacote', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  const region = { x: 0, y: 0, width: 1, height: 1 }
  try {
    const staged = runtime.stageSource(new Uint8Array([40, 60, 80, 101]), 1, 1, 1)
    for (const plan of [null, {}, { fillOpacity: NaN, effects: [] }, { fillOpacity: -1, effects: [] },
      { fillOpacity: 100, effects: new Array(2) }, { fillOpacity: 100, effects: Array.from({ length: 65 }, () => batchPlan.effects[0]) },
      { ...batchPlan, effects: [{ type: 'drop-shadow', effect: batchPlan.effects[0]!.effect }] },
      { ...batchPlan, thisLayerBlendIf: { channel: 'constructor', shadows: [0, 0], highlights: [255, 255] } },
      { ...batchPlan, effects: [{ type: 'color-overlay', effect: { color: new Array(4), opacity: 100, blendMode: 'normal' } }] }]) {
      assert.throws(() => runtime.localBatchStagedRegion(staged.sourceId, region, plan as RustPixelPocBatchPlan), invalid)
    }
    assert.throws(() => encodeLocalBatch(batchPlan, 64 * 1024 * 1024, 16 * 1024 * 1024),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
    assert.throws(() => encodeLocalBatch(batchPlan, NaN, 4), invalid)
    assert.equal(runtime.localBatchStagedRegion(staged.sourceId, region, batchPlan).generation, 1)
    runtime.invalidateSource(2)
    assert.throws(() => runtime.localBatchStagedRegion(staged.sourceId, region, batchPlan), invalid)
    runtime.dispose()
    assert.throws(() => runtime.localBatchStagedRegion(staged.sourceId, region, batchPlan),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-unavailable')
  } finally { runtime.dispose() }
})

test('Falhas de alocação/kernel do lote liberam temporários e permitem recuperação', async context => {
  const real = await WebAssembly.instantiate(wasm, {})
  const raw = real.instance.exports as unknown as { axia_poc_alloc(length: number): number;
    axia_poc_free(pointer: number, length: number): void; axia_poc_local_batch_region(...args: number[]): number }
  const live = new Map<number, number>()
  let failAt = 0, calls = 0, failKernel = false
  const batch = (...args: number[]) => failKernel ? 6 : raw.axia_poc_local_batch_region(...args)
  Object.defineProperty(batch, 'length', { value: 12 })
  const mock = context.mock.method(WebAssembly, 'instantiate', async () => ({ module: real.module, instance: { exports: {
    ...real.instance.exports, axia_poc_local_batch_region: batch,
    axia_poc_alloc(length: number) {
      if (++calls === failAt) return 0
      const pointer = raw.axia_poc_alloc(length)
      if (pointer) live.set(pointer, length)
      return pointer
    },
    axia_poc_free(pointer: number, length: number) {
      assert.equal(live.get(pointer), length)
      live.delete(pointer); raw.axia_poc_free(pointer, length)
    }
  } } } as unknown as WebAssembly.WebAssemblyInstantiatedSource))
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const source = new Uint8Array([40, 60, 80, 101])
    const staged = runtime.stageSource(source, 1, 1, 1), region = { x: 0, y: 0, width: 1, height: 1 }
    for (const allocation of [1, 2]) {
      calls = 0; failAt = allocation
      assert.throws(() => runtime.localBatchStagedRegion(staged.sourceId, region, batchPlan),
        (error: unknown) => error instanceof RustPixelPocError && error.code === 'wasm-failure')
      assert.equal(live.size, 1)
    }
    failAt = 0; failKernel = true
    assert.throws(() => runtime.localBatchStagedRegion(staged.sourceId, region, batchPlan),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
    assert.equal(live.size, 1)
    failKernel = false
    assert.deepEqual(runtime.localBatchStagedRegion(staged.sourceId, region, batchPlan).rgba,
      batchReference(source, 1, 1, batchPlan))
    assert.equal(live.size, 1)
  } finally { runtime.dispose(); mock.mock.restore() }
  assert.equal(live.size, 0)
})

test('ABI lote rejeita metadados/payload inválidos sem publicar saída parcial', async () => {
  const { instance } = await WebAssembly.instantiate(wasm, {})
  const exports = instance.exports as unknown as { memory: WebAssembly.Memory;
    axia_poc_alloc(length: number): number; axia_poc_free(pointer: number, length: number): void;
    axia_poc_local_batch_region(...args: number[]): number }
  const packet = encodeLocalBatch(batchPlan, 4, 4)
  const lengths = [4, packet.length, 4], pointers = lengths.map(length => exports.axia_poc_alloc(length))
  const [source, commands, output] = pointers as [number, number, number]
  const bytes = new Uint8Array(exports.memory.buffer)
  bytes.set([40, 60, 80, 101], source)
  const args = [source, 4, 1, 1, 0, 0, 1, 1, commands, packet.length, output, 4]
  const check = (data: Uint8Array, status: number) => {
    bytes.set(data, commands); bytes.fill(99, output, output + 4)
    assert.equal(exports.axia_poc_local_batch_region(...args), status)
    assert.deepEqual([...bytes.slice(output, output + 4)], [99, 99, 99, 99])
  }
  try {
    for (const [offset, value, status] of [[0, 0, 2], [4, 2, 2], [8, 65, 2], [24, 2, 2],
      [32, 99, 2], [32 + 80, 1, 2], [32 + 96 + 56, 0, 1], [32 + 96 + 60, 0xffffffff, 1],
      [32 + 96 + 72, 5, 2], [32 + 192 + 72, 0, 2]]) {
      const bad = packet.slice(); new DataView(bad.buffer).setUint32(offset!, value!, true); check(bad, status!)
    }
    const badOpacity = packet.slice(); new DataView(badOpacity.buffer).setFloat64(32 + 192 + 8, NaN, true); check(badOpacity, 2)
    const badStops = packet.slice(); const stopOffset = new DataView(packet.buffer).getUint32(32 + 96 + 56, true)
    new DataView(badStops.buffer).setFloat64(stopOffset, NaN, true); check(badStops, 2)
    bytes.set(packet, commands)
    for (const pointer of [source, commands + 4]) {
      const before = bytes.slice(pointer, pointer + 4), changed = [...args]; changed[10] = pointer
      assert.equal(exports.axia_poc_local_batch_region(...changed), 5)
      assert.deepEqual(bytes.slice(pointer, pointer + 4), before)
    }
    assert.equal(exports.axia_poc_local_batch_region(...args), 0)
    assert.deepEqual(bytes.slice(output, output + 4), batchReference(new Uint8Array([40, 60, 80, 101]), 1, 1, batchPlan))
  } finally { pointers.forEach((pointer, index) => exports.axia_poc_free(pointer, lengths[index]!)) }
})
