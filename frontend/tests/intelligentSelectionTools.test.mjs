import assert from 'node:assert/strict'
import test from 'node:test'
import {
  availableIntelligentSelectionTool,
  ENABLED_INTELLIGENT_SELECTION_TOOLS,
  intelligentSelectionToolForShortcut,
  INTELLIGENT_SELECTION_TOOLS,
  isIntelligentSelectionTool,
  isIntelligentSelectionToolEnabled,
  nextIntelligentSelectionTool
} from '../src/editor/intelligentSelectionTools.ts'

test('grupo W mantém a ordem de produto aprovada', () => {
  assert.deepEqual(INTELLIGENT_SELECTION_TOOLS, [
    'object-selection',
    'quick-selection',
    'magic-wand'
  ])
  assert.equal(isIntelligentSelectionTool('magic-wand'), true)
  assert.equal(isIntelligentSelectionTool('crop'), false)
})

test('entrega incremental habilita Seleção Rápida e Varinha', () => {
  assert.deepEqual(ENABLED_INTELLIGENT_SELECTION_TOOLS, ['quick-selection', 'magic-wand'])
  assert.equal(availableIntelligentSelectionTool('object-selection'), 'quick-selection')
  assert.equal(availableIntelligentSelectionTool('quick-selection'), 'quick-selection')
  assert.equal(availableIntelligentSelectionTool('magic-wand'), 'magic-wand')
  assert.equal(isIntelligentSelectionToolEnabled('object-selection'), false)
  assert.equal(isIntelligentSelectionToolEnabled('quick-selection'), true)
  assert.equal(isIntelligentSelectionToolEnabled('magic-wand'), true)
  assert.equal(nextIntelligentSelectionTool('quick-selection'), 'magic-wand')
  assert.equal(nextIntelligentSelectionTool('magic-wand'), 'quick-selection')
})

test('atalhos W e Shift+W apontam diretamente para Varinha e Seleção Rápida', () => {
  assert.equal(intelligentSelectionToolForShortcut(false), 'magic-wand')
  assert.equal(intelligentSelectionToolForShortcut(true), 'quick-selection')
})

test('ciclo completo já respeita Objeto, Rápida e Varinha quando as fases forem habilitadas', () => {
  assert.equal(nextIntelligentSelectionTool('object-selection', INTELLIGENT_SELECTION_TOOLS), 'quick-selection')
  assert.equal(nextIntelligentSelectionTool('quick-selection', INTELLIGENT_SELECTION_TOOLS), 'magic-wand')
  assert.equal(nextIntelligentSelectionTool('magic-wand', INTELLIGENT_SELECTION_TOOLS), 'object-selection')
})
