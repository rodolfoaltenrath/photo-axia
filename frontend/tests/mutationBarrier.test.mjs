import assert from 'node:assert/strict'
import test from 'node:test'
import { MutationBarrier } from '../src/editor/mutationBarrier.ts'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('histórico aguarda o commit raster pendente antes de navegar', async () => {
  const barrier = new MutationBarrier()
  const commit = deferred()
  const order = []
  barrier.track(commit.promise.then(() => {
    order.push('commit')
    return true
  }))
  const navigation = barrier.wait().then((committed) => {
    if (committed) order.push('undo')
    return committed
  })
  await Promise.resolve()
  assert.deepEqual(order, [])
  commit.resolve()
  assert.equal(await navigation, true)
  assert.deepEqual(order, ['commit', 'undo'])
  assert.equal(barrier.isPending, false)
})

test('falha no commit não desfaz uma ação anterior por engano', async () => {
  const barrier = new MutationBarrier()
  const commit = deferred()
  barrier.track(commit.promise)
  const navigation = barrier.wait()
  commit.resolve(false)
  assert.equal(await navigation, false)
})

test('limpeza de uma operação antiga não remove uma operação mais recente', async () => {
  const barrier = new MutationBarrier()
  const first = deferred()
  const second = deferred()
  barrier.track(first.promise)
  barrier.track(second.promise)
  first.resolve(true)
  await first.promise
  await Promise.resolve()
  assert.equal(barrier.isPending, true)
  second.resolve(true)
  assert.equal(await barrier.wait(), true)
  assert.equal(barrier.isPending, false)
})

test('operação pendente pode ser descartada sem aguardar sua conclusão', async () => {
  const barrier = new MutationBarrier()
  const commit = deferred()
  barrier.track(commit.promise)

  assert.equal(barrier.discard(), true)
  assert.equal(barrier.isPending, false)
  assert.equal(await barrier.wait(), true)

  commit.resolve(false)
  await commit.promise
  assert.equal(barrier.isPending, false)
  assert.equal(barrier.discard(), false)
})
