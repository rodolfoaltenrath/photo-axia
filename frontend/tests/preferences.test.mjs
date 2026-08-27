import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AUTO_SELECT_LAYER_PREFERENCE,
  readAutoSelectLayerPreference,
  writeAutoSelectLayerPreference
} from '../src/editor/preferences.ts'

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial))
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    value: (key) => values.get(key)
  }
}

test('seleção automática inicia ligada sem preferência gravada', () => {
  assert.equal(readAutoSelectLayerPreference(memoryStorage()), true)
  assert.equal(readAutoSelectLayerPreference(undefined), true)
})

test('seleção automática restaura os dois valores persistidos', () => {
  assert.equal(readAutoSelectLayerPreference(memoryStorage({
    [AUTO_SELECT_LAYER_PREFERENCE]: 'false'
  })), false)
  assert.equal(readAutoSelectLayerPreference(memoryStorage({
    [AUTO_SELECT_LAYER_PREFERENCE]: 'true'
  })), true)
})

test('grava a decisão e tolera armazenamento bloqueado', () => {
  const storage = memoryStorage()
  assert.equal(writeAutoSelectLayerPreference(storage, false), true)
  assert.equal(storage.value(AUTO_SELECT_LAYER_PREFERENCE), 'false')
  const blocked = {
    getItem: () => { throw new Error('blocked') },
    setItem: () => { throw new Error('blocked') }
  }
  assert.equal(readAutoSelectLayerPreference(blocked), true)
  assert.equal(writeAutoSelectLayerPreference(blocked, false), false)
})
