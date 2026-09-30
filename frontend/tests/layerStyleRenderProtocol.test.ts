import assert from 'node:assert/strict'
import test from 'node:test'
import { LayerStyleUnsupportedEffectError } from '../src/editor/layerStyleCompositor.ts'
import { LayerStylePatternMissingError } from '../src/editor/layerStyleRaster.ts'
import {
  deserializeLayerStyleWorkerError,
  serializeLayerStyleWorkerError
} from '../src/editor/layerStyleRenderProtocol.ts'

test('Worker preserva código e tipos do efeito não suportado', () => {
  const original = new LayerStyleUnsupportedEffectError(['future-effect', 'blend-if'])
  const serialized = structuredClone(serializeLayerStyleWorkerError(original))
  const restored = deserializeLayerStyleWorkerError(serialized)
  assert.ok(restored instanceof LayerStyleUnsupportedEffectError)
  assert.equal(restored.code, original.code)
  assert.deepEqual(restored.effectTypes, original.effectTypes)
  assert.equal(restored.message, original.message)
})

test('Worker preserva qual efeito ficou sem padrão decodificado', () => {
  const original = new LayerStylePatternMissingError('stroke')
  const serialized = structuredClone(serializeLayerStyleWorkerError(original))
  const restored = deserializeLayerStyleWorkerError(serialized)
  assert.ok(restored instanceof LayerStylePatternMissingError)
  assert.equal(restored.code, original.code)
  assert.equal(restored.effectType, 'stroke')
  assert.equal(restored.message, original.message)
})

test('Worker tolera erro genérico e mensagens legadas', () => {
  assert.deepEqual(serializeLayerStyleWorkerError(new Error('falha')), {
    code: 'LAYER_STYLE_RENDER_FAILED', message: 'falha'
  })
  assert.equal(deserializeLayerStyleWorkerError('mensagem antiga').message, 'mensagem antiga')
  assert.equal(deserializeLayerStyleWorkerError({
    code: 'LAYER_STYLE_UNSUPPORTED_EFFECT',
    effectTypes: 'inválido',
    message: 'payload incompleto'
  } as unknown as ReturnType<typeof serializeLayerStyleWorkerError>).message, 'payload incompleto')
})
