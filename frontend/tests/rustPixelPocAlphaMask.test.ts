import assert from 'node:assert/strict'
import test from 'node:test'
import { alphaMaskLayout, type RustPixelPocAlphaMask } from '../src/editor/rustPixelPocAlphaMask.ts'
import { RustPixelPocError } from '../src/editor/rustPixelPocError.ts'

const config = { spreadRadius: 2, blurRadius: 4, precise: false }

test('Máscara soma suporte do spread/blur e recorta contexto só na borda da fonte', () => {
  assert.deepEqual(alphaMaskLayout(50, 40, { x: 10, y: 11, width: 7, height: 5 }, config), {
    context: { x: 4, y: 5, width: 19, height: 17 }, halo: 6, workingBytes: 8862
  })
  assert.deepEqual(alphaMaskLayout(5, 3, { x: 4, y: 2, width: 1, height: 1 }, config).context,
    { x: 0, y: 0, width: 5, height: 3 })
  assert.equal(alphaMaskLayout(50, 40, { x: 10, y: 11, width: 7, height: 5 }, { ...config, precise: true }).halo, 6)
})

test('Máscara rejeita raios, geometrias e técnica inválidos', () => {
  const region = { x: 0, y: 0, width: 1, height: 1 }
  for (const bad of [{ ...config, spreadRadius: -1 }, { ...config, blurRadius: 4097 },
    { ...config, blurRadius: NaN }, { ...config, spreadRadius: 0.5 }, { ...config, precise: 1 }, null]) {
    assert.throws(() => alphaMaskLayout(5, 3, region, bad as RustPixelPocAlphaMask),
      (error: unknown) => error instanceof RustPixelPocError && error.code === 'invalid-input')
  }
  for (const bad of [{ ...region, x: -1 }, { ...region, width: 0 }, { ...region, y: 3 }, { ...region, x: 1.5 }]) {
    assert.throws(() => alphaMaskLayout(5, 3, bad, config))
  }
})

test('Máscara limita memória antes de alocar incluindo fila e ambas as máscaras', () => {
  const full = { x: 0, y: 0, width: 4096, height: 4096 }
  assert.throws(() => alphaMaskLayout(4096, 4096, full, config),
    (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
  assert.equal(alphaMaskLayout(4096, 4096, { ...full, width: 1, height: 1 }, { spreadRadius: 0, blurRadius: 0, precise: false }).workingBytes,
    64 * 1024 * 1024 + 6)
  assert.throws(() => alphaMaskLayout(16 * 1024 * 1024, 1, { x: 0, y: 0, width: 4 * 1024 * 1024, height: 1 },
    { spreadRadius: 4096, blurRadius: 0, precise: false }),
    (error: unknown) => error instanceof RustPixelPocError && error.code === 'memory-limit')
})
