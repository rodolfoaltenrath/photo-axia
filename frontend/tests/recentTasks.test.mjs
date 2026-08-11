import assert from 'node:assert/strict'
import test from 'node:test'
import { LatestPathTaskQueue, LatestRequestGate } from '../src/editor/recentTasks.ts'

test('somente a atualização mais recente pode publicar a lista', () => {
  const gate = new LatestRequestGate()
  const first = gate.begin()
  const second = gate.begin()
  assert.equal(first.isCurrent(), false)
  assert.equal(second.isCurrent(), true)
  gate.invalidate()
  assert.equal(second.isCurrent(), false)
})

test('miniaturas do mesmo caminho são serializadas e a antiga fica obsoleta', async () => {
  const queue = new LatestPathTaskQueue()
  const events = []
  let releaseFirst
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve })

  const first = queue.enqueue('C:/Projeto.axia', async (isLatest) => {
    events.push('first:start')
    await firstBlocked
    if (isLatest()) events.push('first:publish')
  })
  const second = queue.enqueue('c:/projeto.axia', async (isLatest) => {
    events.push('second:start')
    if (isLatest()) events.push('second:publish')
  })

  await Promise.resolve()
  releaseFirst()
  await Promise.all([first, second])
  assert.deepEqual(events, ['first:start', 'second:start', 'second:publish'])
})
