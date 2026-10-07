import assert from 'node:assert/strict'
import test from 'node:test'
import { RustPixelPocError } from '../src/editor/rustPixelPocError.ts'
import { RustStylePreviewMediaCache, type RustStyleMediaReader } from '../src/editor/rustStylePreviewMediaCache.ts'

const signal = () => new AbortController().signal
const code = (expected: string) => (error: unknown) => error instanceof RustPixelPocError && error.code === expected
const blob = new Blob(['bytes'], { type: 'image/png' })
function fixture(bytes = 1024, entries = 64) {
  let loads = 0
  const cache = new RustStylePreviewMediaCache(bytes, entries)
  const reader: RustStyleMediaReader = async () => { loads++; return blob }
  const read = (key: string, version = '1', url = `blob:${key}`, limit = 64 * 1024 * 1024) => cache.read(key, version, url, signal(), limit, reader)
  return { cache, reader, read, loads: () => loads }
}

test('Cache valida limites antes de guardar mídia; capacidade zero desativa retenção', async () => {
  for (const bytes of [-1, 1.5, NaN, 32 * 1024 * 1024 + 1]) {
    assert.throws(() => new RustStylePreviewMediaCache(bytes), code('invalid-input'))
  }
  for (const entries of [0, -1, 1.5, 65]) assert.throws(() => new RustStylePreviewMediaCache(1024, entries), code('invalid-input'))
  const f = fixture(0)
  await f.read('A'); await f.read('A')
  assert.equal(f.loads(), 2); assert.equal(f.cache.stats.entries, 0); assert.equal(f.cache.stats.bytes, 0)
})

test('Hit conserva Blob/MIME e cobra metadados; versão ou URL diferente recarrega', async () => {
  const f = fixture()
  assert.equal(await f.read('A'), blob); assert.equal(await f.read('A'), blob)
  assert.equal(f.loads(), 1); assert.equal(f.cache.stats.hits, 1)
  assert.equal(f.cache.stats.bytes, blob.size + ('A'.length + '1'.length + 'blob:A'.length) * 2)
  await f.read('A', '2'); await f.read('A', '2', 'blob:B')
  assert.equal(f.loads(), 3); assert.equal(f.cache.stats.entries, 1)
  assert.equal((await f.read('A', '2', 'blob:B')).type, 'image/png')
})

test('LRU respeita bytes e quantidade; tocar A faz B ser retirado antes de C', async () => {
  for (const f of [fixture(42), fixture(1024, 2)]) {
    await f.read('A'); await f.read('B'); await f.read('A'); await f.read('C')
    assert.equal(f.cache.stats.entries, 2); assert.equal(f.cache.stats.evictions, 1)
    await f.read('A'); assert.equal(f.loads(), 3)
    await f.read('B'); assert.equal(f.loads(), 4)
    assert.ok(f.cache.stats.bytes <= f.cache.maxBytes)
    f.cache.clear(); assert.equal(f.cache.stats.bytes, 0)
  }
})

test('Entrada maior que cache ou metadados extensos não impedem leitura dentro do limite', async () => {
  for (const f of [fixture(20), fixture(1024)]) {
    const url = f.cache.maxBytes === 20 ? 'blob:A' : 'data:image/png;base64,' + 'A'.repeat(1024)
    assert.equal(await f.read('A', '1', url), blob); assert.equal(await f.read('A', '1', url), blob)
    assert.equal(f.loads(), 2); assert.equal(f.cache.stats.entries, 0)
  }
})

test('HTTP e caminhos mutáveis nunca são guardados, mesmo com chave e versão iguais', async () => {
  const f = fixture()
  for (const url of ['https://example.test/image.png', '/asset.png', 'file:///image.png']) {
    await f.read('A', '1', url); await f.read('A', '1', url)
  }
  assert.equal(f.loads(), 6); assert.equal(f.cache.stats.hits, 0); assert.equal(f.cache.stats.entries, 0)
})

test('Hit não contorna limite de mídia ou abort; entrada inválida não chama reader', async () => {
  const f = fixture(); await f.read('A')
  await assert.rejects(f.read('A', '1', 'blob:A', 4), code('memory-limit'))
  for (const limit of [0, -1, 1.5, NaN, 64 * 1024 * 1024 + 1]) {
    await assert.rejects(f.read('A', '1', 'blob:A', limit), code('memory-limit'))
  }
  const controller = new AbortController(); controller.abort()
  await assert.rejects(f.cache.read('A', '1', 'blob:A', controller.signal, 64, f.reader), { name: 'AbortError' })
  await assert.rejects(f.read(''), code('invalid-input')); await assert.rejects(f.read('A', ''), code('invalid-input'))
  assert.equal(f.loads(), 1); assert.equal(f.cache.stats.entries, 1)
})

test('Falha/Blob vazio/oversize não envenenam cache e próxima leitura pode recuperar', async () => {
  const f = fixture()
  for (const reader of [async () => { throw new Error('load failed') }, async () => new Blob([]), async () => blob]) {
    await assert.rejects(f.cache.read('A', '1', 'blob:A', signal(), 4, reader))
    assert.equal(f.cache.stats.entries, 0)
  }
  await f.read('A'); await f.read('A'); assert.equal(f.loads(), 1)
})

test('Clear e release impedem preenchimento tardio sem revogar Blob emprestado', async () => {
  for (const retire of [(cache: RustStylePreviewMediaCache) => cache.clear(),
    (cache: RustStylePreviewMediaCache) => cache.releaseConsumer('canvas:a')]) {
    const f = fixture()
    let finish!: (blob: Blob) => void
    const pending = f.cache.read('source:canvas:a', '1', 'blob:A', signal(), 64, () => new Promise(resolve => { finish = resolve }))
    retire(f.cache); finish(blob)
    assert.equal(await pending, blob); assert.equal(f.cache.stats.entries, 0)
    const borrowed = await f.read('source:canvas:a')
    retire(f.cache); assert.equal(await borrowed.text(), 'bytes')
    assert.equal(f.cache.stats.entries, 0)
  }
})

test('Abort depois de reader que ignora signal rejeita e nunca guarda mídia', async () => {
  const f = fixture(), controller = new AbortController()
  let finish!: (blob: Blob) => void
  const pending = f.cache.read('A', '1', 'blob:A', controller.signal, 64, () => new Promise(resolve => { finish = resolve }))
  const rejected = assert.rejects(pending, { name: 'AbortError' })
  controller.abort(); finish(blob); await rejected
  assert.equal(f.cache.stats.bytes, 0); assert.equal(f.cache.stats.entries, 0)
})

test('Leitura antiga fora de ordem não sobrescreve preenchimento mais novo', async () => {
  const f = fixture()
  let finish!: (blob: Blob) => void
  const pending = f.cache.read('A', '1', 'blob:old', signal(), 64, () => new Promise(resolve => { finish = resolve }))
  const latest = await f.read('A', '2', 'blob:new')
  finish(new Blob(['old'])); await pending
  assert.equal(await f.read('A', '2', 'blob:new'), latest); assert.equal(f.loads(), 1)
})

test('Remover A conserva fontes de B e padrões compartilhados; clear remove tudo', async () => {
  const f = fixture()
  await f.read('source:canvas:a'); await f.read('source:canvas:b'); await f.read('pattern:p')
  f.cache.releaseConsumer('canvas:a'); assert.equal(f.cache.stats.entries, 2)
  await f.read('source:canvas:b'); await f.read('pattern:p'); assert.equal(f.loads(), 3)
  await f.read('source:canvas:a'); assert.equal(f.loads(), 4)
  f.cache.clear(); assert.equal(f.cache.stats.entries, 0); assert.equal(f.cache.stats.bytes, 0)
})
