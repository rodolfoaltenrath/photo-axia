import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyRustStyleDecodeTimings, snapshotRustStyleDecodeTimings } from '../src/editor/rustStyleMediaTimings.ts'
import { summarizeRustStyleMediaSamples, type RustStyleMediaSample } from '../src/editor/rustStyleMediaMeasurement.ts'

const sample = (): RustStyleMediaSample => ({ wallMs: 10, kernelMs: 2, pngEncodeMs: 3, canvasUploadMs: 1,
  media: { sourceReused: false, source: { ...emptyRustStyleDecodeTimings(), rasterDecodes: 1, rgbaBytes: 4, bitmapMs: 4 },
    patterns: emptyRustStyleDecodeTimings(), sourcePaddingMs: 1, sourceStagingMs: 1 } })

test('Snapshot de mídia é independente e não carrega metadados extras', () => {
  const input = { ...emptyRustStyleDecodeTimings(), bitmapMs: 2, rasterDecodes: 1, rgbaBytes: 4, url: 'private-source' }
  const snapshot = snapshotRustStyleDecodeTimings(input)!
  input.bitmapMs = 99
  assert.equal(snapshot.bitmapMs, 2); assert.equal(Object.hasOwn(snapshot, 'url'), false)
  assert.equal(snapshotRustStyleDecodeTimings(undefined), null)
  assert.notEqual(emptyRustStyleDecodeTimings(), emptyRustStyleDecodeTimings())
})

test('Tempos ausentes/negativos/não finitos e contadores abusivos são rejeitados', () => {
  const baseline = emptyRustStyleDecodeTimings()
  for (const change of [{ headerMs: -1 }, { bitmapMs: NaN }, { readbackMs: Infinity }, { canvasDrawMs: undefined },
    { rasterDecodes: 65 }, { rasterDecodes: 1.5 }, { textDraws: 2 }, { rgbaBytes: 96 * 1024 * 1024 + 1 }]) {
    assert.throws(() => snapshotRustStyleDecodeTimings({ ...baseline, ...change } as typeof baseline), /wasm-failure/)
  }
})

test('Resumo calcula mediana/p95 por fase e conta somente as amostras fornecidas', () => {
  const inputs = [5, 1, 3, 2, 4].map(wallMs => ({ ...sample(), wallMs }))
  const original = structuredClone(inputs), result = summarizeRustStyleMediaSamples(inputs)
  assert.equal(result.samples, 5); assert.equal(result.sourceDecodes, 5); assert.equal(result.patternDecodes, 0)
  assert.deepEqual(result.timings.wallMs, { medianMs: 3, p95Ms: 5 })
  assert.deepEqual(result.timings.sourceBitmapMs, { medianMs: 4, p95Ms: 4 })
  assert.deepEqual(inputs, original)
})

test('Reuso não conta decode/padding/staging da fonte anterior novamente', () => {
  const reused = sample()
  reused.media = { ...reused.media, sourceReused: true, source: emptyRustStyleDecodeTimings(), sourcePaddingMs: 0, sourceStagingMs: 0 }
  const result = summarizeRustStyleMediaSamples([sample(), reused])
  assert.equal(result.sourceDecodes, 1); assert.equal(result.reusedSources, 1)
  reused.media.source!.bitmapMs = 1
  assert.throws(() => summarizeRustStyleMediaSamples([reused]), /reused-source-charged/)
})

test('Resumo recusa ausência de métricas, amostras vazias/excessivas e wall time inválido', () => {
  assert.throws(() => summarizeRustStyleMediaSamples([]), /invalid-media-samples/)
  assert.throws(() => summarizeRustStyleMediaSamples(Array.from({ length: 101 }, sample)), /invalid-media-samples/)
  const missing = sample(); missing.media.source = null
  assert.throws(() => summarizeRustStyleMediaSamples([missing]), /missing-media-timings/)
  assert.throws(() => summarizeRustStyleMediaSamples([{ ...sample(), wallMs: NaN }]), /invalid-media-timing/)
})
