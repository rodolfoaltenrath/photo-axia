import assert from 'node:assert/strict'
import test from 'node:test'
import { RustPixelPocError } from '../src/editor/rustPixelPocError.ts'
import { readRustStyleImageDimensions, RUST_STYLE_IMAGE_HEADER_BYTES, rustStyleImageDimensions } from '../src/editor/rustStyleImageHeader.ts'

function png(width = 200, height = 100) {
  const bytes = new Uint8Array(33), view = new DataView(bytes.buffer)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  view.setUint32(8, 13); view.setUint32(12, 0x49484452)
  view.setUint32(16, width); view.setUint32(20, height)
  return bytes
}

function gif(version = '89a', width = 200, height = 100) {
  const bytes = new Uint8Array(13), view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode(`GIF${version}`))
  view.setUint16(6, width, true); view.setUint16(8, height, true)
  return bytes
}

function jpeg(marker = 0xc0, width = 200, height = 100) {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0, 4, 0, 0,
    0xff, marker, 0, 11, 8, height >> 8, height & 255, width >> 8, width & 255, 1, 1, 0x11, 0])
}

const code = (expected: string) => (error: unknown) => error instanceof RustPixelPocError && error.code === expected
const dimensions = { width: 200, height: 100, bytes: 80_000 }

test('Cabeçalhos PNG, GIF87a/GIF89a e JPEG sequencial/progressivo independem do MIME', async () => {
  for (const bytes of [png(), gif(), gif('87a'), jpeg(), jpeg(0xc2)]) {
    assert.deepEqual(rustStyleImageDimensions(bytes.buffer), dimensions)
    assert.deepEqual(await readRustStyleImageDimensions(new Blob([bytes], { type: 'text/plain' }), () => {}), dimensions)
  }
})

test('Dimensões nulas, assinaturas, IHDR, versões GIF e segmentos JPEG inválidos são rejeitados', () => {
  const badChunk = png(); badChunk[12] = 0
  const badLength = png(); badLength[11] = 12
  const badSignature = png(); badSignature[7] = 0
  const badJpegLength = jpeg(); badJpegLength[5] = 1
  const badComponents = jpeg(); badComponents[17] = 2
  const badFrame = jpeg(); badFrame[10] = 0; badFrame[11] = 2
  const missingMarker = jpeg(); missingMarker[8] = 0
  for (const bytes of [png(0), png(1, 0), gif('90a'), gif('89a', 0), jpeg(0xc0, 0),
    badChunk, badLength, badSignature, badJpegLength, badComponents, badFrame, missingMarker,
    Uint8Array.from([0xff, 0xd8, 0xff, 0xda, 0, 2]), new TextEncoder().encode('<svg width="100000"/>')]) {
    assert.throws(() => rustStyleImageDimensions(bytes.buffer), code('invalid-input'))
  }
})

test('Todos os prefixos truncados falham sem RangeError', () => {
  for (const bytes of [png(), gif(), jpeg()]) {
    for (let end = 0; end < bytes.length; end++) {
      assert.throws(() => rustStyleImageDimensions(bytes.slice(0, end).buffer), code('invalid-input'))
    }
  }
})

test('Limites de 64 MiB e 16384 por eixo são inclusivos e rejeitam produto exagerado', () => {
  assert.equal(rustStyleImageDimensions(png(4096, 4096).buffer).bytes, 64 * 1024 * 1024)
  assert.equal(rustStyleImageDimensions(png(16_384, 1).buffer).width, 16_384)
  for (const bytes of [png(4096, 4097), png(16_385, 1), png(1, 16_385), png(0xffffffff, 0xffffffff),
    gif('89a', 65535, 65535), jpeg(0xc0, 65535, 65535)]) {
    assert.throws(() => rustStyleImageDimensions(bytes.buffer), code('memory-limit'))
  }
})

test('JPEG aceita fill bytes/TEM e ignora metadados completos antes do SOF', () => {
  const frame = jpeg().slice(8)
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xff, 0x01, 0xff, 0xfe, 0, 4, 0, 0, ...frame])
  assert.deepEqual(rustStyleImageDimensions(bytes.buffer), dimensions)
})

test('Leitura é limitada a 256 KiB e não usa arrayBuffer do arquivo inteiro', async () => {
  let slices = 0
  class BoundedBlob extends Blob {
    override arrayBuffer(): Promise<ArrayBuffer> { throw new Error('whole-file-read') }
    override slice(start?: number, end?: number) {
      slices++; assert.equal(start, 0); assert.equal(end, RUST_STYLE_IMAGE_HEADER_BYTES)
      return new Blob([png()])
    }
  }
  assert.deepEqual(await readRustStyleImageDimensions(new BoundedBlob(['payload']), () => {}), dimensions)
  assert.equal(slices, 1)
})

test('Cancelamento antes/depois da leitura não permite prosseguir com o cabeçalho', async () => {
  let reads = 0, checks = 0
  class ObservedBlob extends Blob {
    override slice() { reads++; return new Blob([png()]) }
  }
  const blob = new ObservedBlob(['payload'])
  await assert.rejects(readRustStyleImageDimensions(blob, () => { throw new Error('obsolete') }), /obsolete/)
  assert.equal(reads, 0)
  await assert.rejects(readRustStyleImageDimensions(blob, () => { if (++checks === 2) throw new Error('obsolete') }), /obsolete/)
  assert.equal(reads, 1)
})

test('SOF após o limite não causa leitura adicional nem confiança nas dimensões editoriais', async () => {
  const parts: Uint8Array<ArrayBuffer>[] = [Uint8Array.from([0xff, 0xd8])]
  for (let i = 0; i < 5; i++) {
    const segment = new Uint8Array(65537); segment.set([0xff, 0xe1, 0xff, 0xff]); parts.push(segment)
  }
  parts.push(jpeg().slice(8))
  await assert.rejects(readRustStyleImageDimensions(new Blob(parts), () => {}), code('invalid-input'))
})
