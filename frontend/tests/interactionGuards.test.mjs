import assert from 'node:assert/strict'
import test from 'node:test'
import { canCreateDocument, editorIsBlockedByModal } from '../src/editor/interactionGuards.ts'

test('qualquer modal de decisão isola os atalhos do editor', () => {
  assert.equal(editorIsBlockedByModal(false, false), false)
  assert.equal(editorIsBlockedByModal(true, false), true)
  assert.equal(editorIsBlockedByModal(false, true), true)
  assert.equal(editorIsBlockedByModal(true, true), true)
})

test('criação duplicada é bloqueada durante operação ou validação', () => {
  assert.equal(canCreateDocument(false, ''), true)
  assert.equal(canCreateDocument(true, ''), false)
  assert.equal(canCreateDocument(false, 'Dimensão inválida'), false)
})
