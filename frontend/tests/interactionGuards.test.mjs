import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canCreateDocument,
  editorIsBlockedByModal,
  isInspectorShortcut
} from '../src/editor/interactionGuards.ts'

test('qualquer modal de decisão isola os atalhos do editor', () => {
  assert.equal(editorIsBlockedByModal(false, false), false)
  assert.equal(editorIsBlockedByModal(true, false), true)
  assert.equal(editorIsBlockedByModal(false, true), true)
  assert.equal(editorIsBlockedByModal(true, true), true)
  assert.equal(editorIsBlockedByModal(false, false, true), true)
})

test('criação duplicada é bloqueada durante operação ou validação', () => {
  assert.equal(canCreateDocument(false, ''), true)
  assert.equal(canCreateDocument(true, ''), false)
  assert.equal(canCreateDocument(false, 'Dimensão inválida'), false)
})

test('atalhos do inspetor são bloqueados nas plataformas desktop', () => {
  const shortcut = (overrides = {}) => ({
    altKey: false,
    code: '',
    ctrlKey: false,
    key: '',
    metaKey: false,
    shiftKey: false,
    ...overrides
  })

  assert.equal(isInspectorShortcut(shortcut({ key: 'F12' })), true)
  assert.equal(isInspectorShortcut(shortcut({ code: 'KeyI', ctrlKey: true, shiftKey: true })), true)
  assert.equal(isInspectorShortcut(shortcut({ altKey: true, code: 'KeyC', metaKey: true })), true)
  assert.equal(isInspectorShortcut(shortcut({ code: 'KeyI', ctrlKey: true })), false)
  assert.equal(isInspectorShortcut(shortcut({ code: 'KeyZ', ctrlKey: true, shiftKey: true })), false)
})
