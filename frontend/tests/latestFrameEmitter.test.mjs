import assert from 'node:assert/strict'
import test from 'node:test'
import { LatestFrameEmitter } from '../src/editor/latestFrameEmitter.ts'

function harness(emit) {
  let sequence = 0
  const callbacks = new Map()
  const emitter = new LatestFrameEmitter(emit, {
    cancel: (handle) => callbacks.delete(handle),
    schedule: (callback) => {
      sequence += 1
      callbacks.set(sequence, callback)
      return sequence
    }
  })
  return {
    emitter,
    frame() {
      const entry = callbacks.entries().next().value
      if (!entry) return false
      callbacks.delete(entry[0])
      entry[1]()
      return true
    },
    scheduled: () => callbacks.size
  }
}

test('mantém somente o preview mais recente dentro do mesmo frame', async () => {
  const values = []
  const control = harness(async (value) => values.push(value))
  control.emitter.enqueue(1)
  control.emitter.enqueue(2)
  control.emitter.enqueue(3)
  assert.equal(control.scheduled(), 1)
  control.frame()
  await Promise.resolve()
  assert.deepEqual(values, [3])
})

test('aplica backpressure e substitui a fila enquanto o envio está ocupado', async () => {
  const values = []
  let release
  const firstDone = new Promise((resolve) => { release = resolve })
  const control = harness(async (value) => {
    values.push(value)
    if (value === 1) await firstDone
  })
  control.emitter.enqueue(1)
  control.frame()
  control.emitter.enqueue(2)
  control.emitter.enqueue(3)
  assert.equal(control.scheduled(), 0)
  release()
  await firstDone
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(control.scheduled(), 1)
  control.frame()
  await Promise.resolve()
  assert.deepEqual(values, [1, 3])
})

test('clear e stop descartam trabalho que ainda não foi enviado', () => {
  const values = []
  const control = harness(async (value) => values.push(value))
  control.emitter.enqueue(1)
  control.emitter.clear()
  assert.equal(control.scheduled(), 0)
  control.emitter.enqueue(2)
  control.emitter.stop()
  control.emitter.enqueue(3)
  assert.equal(control.scheduled(), 0)
  assert.deepEqual(values, [])
})
