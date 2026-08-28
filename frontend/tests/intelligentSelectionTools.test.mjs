import assert from 'node:assert/strict'
import test from 'node:test'
import {
  availableIntelligentSelectionTool,
  ENABLED_INTELLIGENT_SELECTION_TOOLS,
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

test('entrega incremental mantém somente a Varinha habilitada', () => {
  assert.deepEqual(ENABLED_INTELLIGENT_SELECTION_TOOLS, ['magic-wand'])
  assert.equal(availableIntelligentSelectionTool('object-selection'), 'magic-wand')
  assert.equal(availableIntelligentSelectionTool('quick-selection'), 'magic-wand')
  assert.equal(availableIntelligentSelectionTool('magic-wand'), 'magic-wand')
  assert.equal(isIntelligentSelectionToolEnabled('object-selection'), false)
  assert.equal(isIntelligentSelectionToolEnabled('quick-selection'), false)
  assert.equal(isIntelligentSelectionToolEnabled('magic-wand'), true)
  assert.equal(nextIntelligentSelectionTool('magic-wand'), 'magic-wand')
})

test('ciclo completo já respeita Objeto, Rápida e Varinha quando as fases forem habilitadas', () => {
  assert.equal(nextIntelligentSelectionTool('object-selection', INTELLIGENT_SELECTION_TOOLS), 'quick-selection')
  assert.equal(nextIntelligentSelectionTool('quick-selection', INTELLIGENT_SELECTION_TOOLS), 'magic-wand')
  assert.equal(nextIntelligentSelectionTool('magic-wand', INTELLIGENT_SELECTION_TOOLS), 'object-selection')
})
