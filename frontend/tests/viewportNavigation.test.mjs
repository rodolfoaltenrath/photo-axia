import assert from 'node:assert/strict'
import test from 'node:test'
import { centeredScrollOffset, preserveViewportCenter } from '../src/editor/viewportNavigation.ts'

test('centraliza o conteudo nos dois eixos', () => {
  assert.equal(centeredScrollOffset(2000, 800), 600)
  assert.equal(centeredScrollOffset(1400, 600), 400)
  assert.equal(centeredScrollOffset(400, 800), 0)
})

test('preserva o ponto central quando o viewport muda de tamanho', () => {
  assert.deepEqual(
    preserveViewportCenter(800, 500, { width: 1200, height: 800 }, { width: 1000, height: 700 }, 0.5),
    {
      type: 'anchor',
      viewportX: 500,
      viewportY: 350,
      documentX: 400,
      documentY: 200
    }
  )
})
