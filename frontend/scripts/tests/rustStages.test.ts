import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { createRustPixelPocRuntime, RustPixelPocError } from '../../src/editor/rustPixelPocRuntime.ts'
import { encodeStyleStages, prepareRustStyleStages, styleStagesLayout } from '../../src/editor/rustPixelPocStages.ts'
import { normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { stagesFixture, combinedStages } from './support/rustStagesFixture.ts'
import { gradientTile } from './support/rustGradientFixture.ts'
import { strokePattern, strokePatternAsset } from './support/rustStrokeFixture.ts'
import type { LayerBlendMode, LayerStyleConfig } from '../../src/types/editor.ts'
import { strokeLayout, strokePacketLength } from '../../src/editor/rustPixelPocStroke.ts'

const wasm = Uint8Array.from(readFileSync(new URL('../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url))).buffer
const light = { angle: 123.5, altitude: 48 }, patterns = new Map([[strokePatternAsset.id, strokePattern]])

test('Executor STG1 reproduz todos os goldens de estilo existentes sem regravar fixtures', async () => {
  const corpus = JSON.parse(readFileSync(new URL('../../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
  const runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0
  try {
    for (const fixture of corpus.rasterCases) {
      const decoded = new Map<string, typeof strokePattern>((fixture.patterns ?? []).map((item: { id: string; width: number; height: number; rgba: number[] }) =>
        [item.id, { width: item.width, height: item.height, rgba: new Uint8Array(item.rgba) }]))
      const job = stagesFixture(new Uint8Array(fixture.source.rgba), fixture.source.width, fixture.source.height,
        normalizeLayerStyleConfig(fixture.styles), fixture.globalLight, fixture.resolutionScale, decoded)
      const staged = runtime.stageSource(job.rgba, job.width, job.height, ++generation)
      assert.deepEqual([...runtime.styleStagesStagedRegion(staged.sourceId, job.region, job.plan).rgba], fixture.expected.rgba, fixture.id)
      assert.equal(job.width, fixture.expected.width); assert.equal(job.height, fixture.expected.height)
      assert.equal(job.expected.offsetX, fixture.expected.offsetX); assert.equal(job.expected.offsetY, fixture.expected.offsetY)
    }
  } finally { runtime.dispose() }
})

for (const mode of ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten'] as LayerBlendMode[]) {
  test(`Executor ${mode}: dez tipos combinados, Fill, ordem e tiles concordam com TS`, async () => {
    const source = Uint8Array.from({ length: 31 * 23 * 4 }, (_, i) => i * 29 % 256), runtime = await createRustPixelPocRuntime(wasm)
    let generation = 0
    try {
      for (const scale of [0.5, 1, 1.375]) for (const fill of [0, 17.5, 73.5, 100]) for (const reverse of [false, true]) {
        const job = stagesFixture(source, 31, 23, combinedStages(mode, fill, reverse), light, scale, patterns)
        const staged = runtime.stageSource(job.rgba, job.width, job.height, ++generation), original = job.rgba.slice()
        assert.deepEqual(runtime.styleStagesStagedRegion(staged.sourceId, job.region, job.plan).rgba, new Uint8Array(job.expected.data))
        assert.deepEqual(job.rgba, original)
        for (let y = 0; y < job.height; y += 5) for (let x = 0; x < job.width; x += 7) {
          const region = { x, y, width: Math.min(7, job.width - x), height: Math.min(5, job.height - y) }
          assert.deepEqual(runtime.styleStagesStagedRegion(staged.sourceId, region, job.plan).rgba,
            gradientTile(new Uint8Array(job.expected.data), job.width, region), `${scale}/${fill}/${reverse}/${x},${y}`)
        }
      }
    } finally { runtime.dispose() }
  })
}

test('Conteúdo preserva sombra externa sob alfa parcial; Fill zero não apaga efeitos externos', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0
  try {
    for (const fill of [0, 50, 73.5, 100]) {
      const styles = normalizeLayerStyleConfig({ fillOpacity: fill, effects: [{ type: 'drop-shadow', id: 'shadow', size: 0,
        distance: 0, color: '#33669980', opacity: 100, layerKnocksOutShadow: false }] })
      const job = stagesFixture(new Uint8Array([200, 120, 40, 101]), 1, 1, styles, light)
      const staged = runtime.stageSource(job.rgba, job.width, job.height, ++generation)
      assert.deepEqual(runtime.styleStagesStagedRegion(staged.sourceId, job.region, job.plan).rgba, new Uint8Array(job.expected.data))
      if (fill === 0) assert.ok(job.expected.data[3]! > 0)
    }
  } finally { runtime.dispose() }
})

test('Executor aceita conteúdo vazio, 64 efeitos, flags desabilitados e máscaras pequenas', async () => {
  const runtime = await createRustPixelPocRuntime(wasm)
  let generation = 0
  try {
    const many = normalizeLayerStyleConfig({ fillOpacity: 0, effects: Array.from({ length: 64 }, (_, i) => ({ type: 'color-overlay', id: `color-${i}`, color: '#33669980', opacity: 1.5 })) })
    assert.equal(many.effects.length, 64)
    const disabled = normalizeLayerStyleConfig({ ...combinedStages(), enabled: false })
    const configs: LayerStyleConfig[] = [normalizeLayerStyleConfig({ fillOpacity: 73.5 }), many, disabled,
      normalizeLayerStyleConfig({ fillOpacity: 0, effects: [{ type: 'bevel-emboss', enabled: false }, { type: 'pattern-overlay' }] })]
    for (const [width, height] of [[1, 17], [19, 1], [1, 1]]) for (const config of configs) {
      const source = Uint8Array.from({ length: width! * height! * 4 }, (_, i) => i * 29 % 256), job = stagesFixture(source, width!, height!, config, light)
      const staged = runtime.stageSource(job.rgba, job.width, job.height, ++generation)
      assert.deepEqual(runtime.styleStagesStagedRegion(staged.sourceId, job.region, job.plan).rgba, new Uint8Array(job.expected.data))
    }
  } finally { runtime.dispose() }
})

test('STG1 valida estágios, contagem, texturas e orçamento antes de alocar pacote', () => {
  const plan = prepareRustStyleStages(combinedStages(), light, 1, patterns), region = { x: 0, y: 0, width: 37, height: 29 }
  const packet = encodeStyleStages(plan, 37, 29, region), layout = styleStagesLayout(plan, 37, 29, region)
  assert.equal(layout.packetBytes, packet.length)
  assert.ok(layout.peakFilterBytes > 0)
  assert.equal(layout.workingBytes, 37 * 29 * 16 + packet.length + 10 * 2048 + layout.peakFilterBytes)
  for (const bad of [{ ...plan, fillOpacity: NaN }, { ...plan, upper: Array(65).fill(plan.upper[0]) },
    { ...plan, internal: [plan.external[0]] }, { ...plan, external: [{ type: 'outer-glow', glow: { ...plan.external[1], kind: 'inner-edge' } }] }]) {
    assert.throws(() => encodeStyleStages(bad as typeof plan, 37, 29, region))
  }
  assert.throws(() => encodeStyleStages(plan, 4096, 4096, { x: 0, y: 0, width: 4096, height: 4096 }),
    (e: unknown) => e instanceof RustPixelPocError && e.code === 'memory-limit')
  assert.throws(() => prepareRustStyleStages(combinedStages(), light, 1), (e: unknown) => e instanceof RustPixelPocError && e.code === 'invalid-input')
  const stroke = plan.upper.find(pass => pass.type === 'stroke')!
  assert.ok(stroke.type === 'stroke')
  const whole = { x: 0, y: 0, width: 2100, height: 2100 }
  assert.ok(strokeLayout(2100, 2100, whole, stroke.stroke, strokePacketLength(stroke.stroke)).workingBytes < 96 * 1024 * 1024)
  assert.throws(() => styleStagesLayout({ fillOpacity: 100, external: [], internal: [], overlay: [], upper: [stroke] }, 2100, 2100, whole),
    (e: unknown) => e instanceof RustPixelPocError && e.code === 'memory-limit')
})
