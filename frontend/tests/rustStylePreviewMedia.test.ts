import assert from 'node:assert/strict'
import test from 'node:test'
import { readRustStylePreviewBlob } from '../src/editor/rustStylePreviewMedia.ts'
import { RustPixelPocError } from '../src/editor/rustPixelPocError.ts'

const code = (expected: string) => (error: unknown) => error instanceof RustPixelPocError && error.code === expected
const signal = () => new AbortController().signal
const fetchResponse = (response: Response): typeof fetch => async () => response

test('Leitor preserva bytes e MIME no limite exato, sem usar response.blob', async () => {
  const response = new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } })
  response.blob = async () => { throw new Error('unbounded read') }
  const blob = await readRustStylePreviewBlob('fixture', signal(), 3, fetchResponse(response))
  assert.equal(blob.type, 'image/png'); assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [1, 2, 3])
})

test('Header acima do orçamento rejeita e cancela corpo antes de consumir', async () => {
  let cancelled = false
  const response = new Response(new ReadableStream({ cancel() { cancelled = true } }), { headers: { 'content-length': '10' } })
  await assert.rejects(readRustStylePreviewBlob('fixture', signal(), 3, fetchResponse(response)), code('memory-limit'))
  assert.equal(cancelled, true)
})

test('Sem header ou com header incorreto, stream acima do limite é interrompido', async () => {
  for (const headers of [new Headers(), new Headers({ 'content-length': '1' })]) {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array(4)) }, cancel() { cancelled = true } })
    await assert.rejects(readRustStylePreviewBlob('fixture', signal(), 3, fetchResponse(new Response(stream, { headers }))), code('memory-limit'))
    assert.equal(cancelled, true); assert.equal(stream.locked, false)
  }
})

test('Abort cancela leitura bloqueada e libera lock do stream', async () => {
  let cancelled = false, opened = () => {}
  const started = new Promise<void>(resolve => { opened = resolve })
  const stream = new ReadableStream<Uint8Array>({ pull() { opened() }, cancel() { cancelled = true } })
  const controller = new AbortController()
  const pending = readRustStylePreviewBlob('fixture', controller.signal, 3, fetchResponse(new Response(stream)))
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  await started; controller.abort(); await rejected
  assert.equal(cancelled, true); assert.equal(stream.locked, false)
})

test('Abort durante fetch não deixa corpo tardio aberto', async () => {
  let cancelled = false
  const stream = new ReadableStream({ cancel() { cancelled = true } }), controller = new AbortController()
  const pending = readRustStylePreviewBlob('fixture', controller.signal, 3, async () => {
    controller.abort(); return new Response(stream)
  })
  await assert.rejects(pending, { name: 'AbortError' })
  assert.equal(cancelled, true); assert.equal(stream.locked, false)
})

test('Corpo vazio, ausente e status inválido não produzem mídia; limite inválido não faz fetch', async () => {
  for (const response of [new Response(''), new Response(null), new Response('error', { status: 503 })]) {
    await assert.rejects(readRustStylePreviewBlob('fixture', signal(), 3, fetchResponse(response)), code('invalid-input'))
  }
  let calls = 0
  for (const limit of [0, -1, 1.5, NaN, 64 * 1024 * 1024 + 1]) {
    await assert.rejects(readRustStylePreviewBlob('fixture', signal(), limit, async () => { calls++; return new Response('x') }), code('memory-limit'))
  }
  const controller = new AbortController(); controller.abort()
  await assert.rejects(readRustStylePreviewBlob('fixture', controller.signal, 3, async () => { calls++; return new Response('x') }), { name: 'AbortError' })
  assert.equal(calls, 0)
})
