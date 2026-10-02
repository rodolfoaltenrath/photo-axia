import assert from 'node:assert/strict'
import test from 'node:test'
import { summarizePreviewFrames, type PreviewFrameSample } from '../benchmarks/previewWailsProbe.ts'

function sample(overrides: Partial<PreviewFrameSample> = {}): PreviewFrameSample {
  return { label: 'test', started: 100, ended: 200, callbacks: [110, 120, 180, 190],
    longTasks: [], longTasksSupported: true, visibilityChanged: false, operationMs: 80,
    lostActive: false, ...overrides }
}

test('métricas do preview distinguem intervalos, cauda e tarefas na janela observada', () => {
  const metrics = summarizePreviewFrames(sample({ longTasks: [
    { startTime: 70, duration: 50 }, { startTime: 170, duration: 70 },
    { startTime: 250, duration: 80 }
  ] }))
  assert.equal(metrics.callbackRateHz, 40)
  assert.equal(metrics.medianCallbackIntervalMs, 10)
  assert.equal(metrics.p95CallbackIntervalMs, 60)
  assert.equal(metrics.maxCallbackGapMs, 60)
  assert.equal(metrics.gapsOver50Ms, 1)
  assert.equal(metrics.longTaskCount, 2)
  assert.equal(metrics.longTaskMs, 50, 'tarefas são recortadas aos limites da amostra')
})

test('fase bloqueada sem frames e API indisponível não são anunciadas como fluidas', () => {
  const metrics = summarizePreviewFrames(sample({ callbacks: [], longTasksSupported: false }))
  assert.equal(metrics.callbackCount, 0)
  assert.equal(metrics.maxCallbackGapMs, 100)
  assert.equal(metrics.gapsOver50Ms, 1)
  assert.equal(metrics.p95CallbackIntervalMs, null)
  assert.equal(metrics.longTaskMs, null)
  assert.equal(metrics.longTaskCount, null)
})

test('relógios invertidos ou callbacks fora da janela invalidam a medição', () => {
  for (const overrides of [{ ended: 99 }, { callbacks: [110, 109] },
    { callbacks: [99] }, { callbacks: [201] }, { callbacks: [NaN] }]) {
    assert.throws(() => summarizePreviewFrames(sample(overrides)), /invalid-frame-sample/)
  }
})
