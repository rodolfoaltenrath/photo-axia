import assert from 'node:assert/strict'
import test from 'node:test'
import { encodeRustStylePng, rustStylePngLayout } from '../../src/editor/rustPixelPocPng.ts'
import { RustPixelPocError } from '../../src/editor/rustPixelPocError.ts'
import { installRustMediaFixtures } from './support/rustMediaFixture.ts'

const pixels = new Uint8Array([10, 20, 30, 255])
const noop = () => {}
const code = (value: string) => (error: unknown) => error instanceof RustPixelPocError && error.code === value

test('PNG preflight cobra RGBA/Canvas/encoder e buffers retidos, sem alocar antes de rejeitar', async () => {
  const fixture = installRustMediaFixtures()
  try {
    assert.deepEqual(rustStylePngLayout(2, 3, 16), { rgbaBytes: 24, workingBytes: 88 })
    for (const [width, height, retained] of [[0, 1, 0], [1.5, 1, 0], [NaN, 1, 0], [1, 1, -1]]) {
      assert.throws(() => rustStylePngLayout(width!, height!, retained!), code('invalid-input'))
    }
    assert.throws(() => rustStylePngLayout(4096, 4096), code('memory-limit'))
    await assert.rejects(encodeRustStylePng(pixels, 1, 1, noop, 96 * 1024 * 1024), code('memory-limit'))
    assert.equal(fixture.state.canvases.length, 0)
  } finally { fixture.restore() }
})

test('PNG usa somente a view RGBA, não destaca/muda buffers e libera Canvas no sucesso', async () => {
  const fixture = installRustMediaFixtures()
  try {
    const backing = new Uint8Array([99, 99, 99, 99, 10, 20, 30, 255, 98, 98, 98, 98])
    const original = backing.slice()
    const result = await encodeRustStylePng(backing.subarray(4, 8), 1, 1, noop)
    assert.deepEqual(JSON.parse(await result.blob.text()), { width: 1, height: 1, rgba: [...pixels] })
    assert.equal(result.blob.type, 'image/png'); assert.deepEqual(backing, original)
    assert.equal(fixture.state.uploads, 1); assert.equal(fixture.state.encodes, 1)
    assert.ok(Object.values(result.encoding).every(value => Number.isFinite(value) && value >= 0))
    assert.ok(fixture.state.canvases.every(canvas => canvas.width === 1 && canvas.height === 1))
  } finally { fixture.restore() }
})

test('Bytes incompatíveis e APIs ausentes falham sem criar Canvas', async () => {
  const fixture = installRustMediaFixtures()
  try {
    for (const source of [new Uint8Array(0), new Uint8Array(3), new Uint8Array(8), new Uint8ClampedArray(4) as unknown as Uint8Array]) {
      await assert.rejects(encodeRustStylePng(source, 1, 1, noop), code('invalid-input'))
    }
    Reflect.deleteProperty(globalThis, 'ImageData')
    await assert.rejects(encodeRustStylePng(pixels, 1, 1, noop), code('wasm-unavailable'))
    assert.equal(fixture.state.canvases.length, 0)
  } finally { fixture.restore() }
})

test('Encode obsoleto não publica Blob e limpa Canvas após o await', async () => {
  const fixture = installRustMediaFixtures()
  let release!: () => void
  try {
    let current = true
    const check = () => { if (!current) throw new RustPixelPocError('invalid-input') }
    fixture.state.encodeBlock = new Promise<void>(resolve => { release = resolve })
    const pending = encodeRustStylePng(pixels, 1, 1, check)
    assert.equal(fixture.state.encodes, 1)
    current = false; release()
    await assert.rejects(pending, code('invalid-input'))
    assert.ok(fixture.state.canvases.every(canvas => canvas.width === 1 && canvas.height === 1))
    await assert.rejects(encodeRustStylePng(pixels, 1, 1, check), code('invalid-input'))
    assert.equal(fixture.state.encodes, 1)
  } finally { release(); fixture.restore() }
})

test('Falha de encode/MIME/Blob vazio limpa recursos e permite próxima conversão', async () => {
  const fixture = installRustMediaFixtures({ failEncodeCount: 1 })
  try {
    await assert.rejects(encodeRustStylePng(pixels, 1, 1, noop), code('wasm-failure'))
    fixture.state.badMime = true
    await assert.rejects(encodeRustStylePng(pixels, 1, 1, noop), code('wasm-failure'))
    fixture.state.badMime = false; fixture.state.emptyBlob = true
    await assert.rejects(encodeRustStylePng(pixels, 1, 1, noop), code('wasm-failure'))
    fixture.state.emptyBlob = false
    assert.equal((await encodeRustStylePng(pixels, 1, 1, noop)).blob.type, 'image/png')
    assert.ok(fixture.state.canvases.every(canvas => canvas.width === 1 && canvas.height === 1))
  } finally { fixture.restore() }
})

test('Tamanho do Blob pronto é cobrado e não publica resultado que excede orçamento', async () => {
  const fixture = installRustMediaFixtures()
  try {
    await assert.rejects(encodeRustStylePng(pixels, 1, 1, noop, 96 * 1024 * 1024 - 12), code('memory-limit'))
    class LargeBlob extends Blob { override get size() { return 64 * 1024 * 1024 + 1 } }
    globalThis.OffscreenCanvas.prototype.convertToBlob = async () => new LargeBlob(['x'], { type: 'image/png' })
    await assert.rejects(encodeRustStylePng(pixels, 1, 1, noop), code('memory-limit'))
    assert.ok(fixture.state.canvases.every(canvas => canvas.width === 1 && canvas.height === 1))
  } finally { fixture.restore() }
})
