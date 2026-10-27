import { readFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { createRustPixelPocRuntime } from '../src/editor/rustPixelPocRuntime.ts'
import { encodeStyledDocument } from '../src/editor/rustStyledDocument.ts'
import type { RustDocumentRasterLayer } from '../src/editor/rustDocumentComposite.ts'

// Mede o caminho do Worker documental (SDP1 → preparo no WASM → tiles 256×256) com uma foto
// grande, para decidir o orçamento de fontes do consumidor com números e não por estimativa.
const width = Number(process.argv[2] ?? 4000), height = Number(process.argv[3] ?? 3000)
if (![width, height].every(side => Number.isSafeInteger(side) && side >= 256 && side <= 8192)) {
  throw new Error('Uso: benchmark:rust-document-budget -- [largura 256..8192] [altura 256..8192]')
}
const wasm = Uint8Array.from(readFileSync(new URL(
  '../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
))).buffer
const MiB = 1024 * 1024
const photo = new Uint8Array(width * height * 4)
for (let index = 0; index < photo.length; index += 4) {
  photo[index] = index * 7 % 251; photo[index + 1] = index * 13 % 241; photo[index + 2] = index * 3 % 239; photo[index + 3] = 255
}

type Case = { name: string; documentWidth: number; documentHeight: number; scale: number; sampling?: RustDocumentRasterLayer['sampling'] }
const cases: Case[] = [
  { name: 'foto 1:1', documentWidth: width, documentHeight: height, scale: 1 },
  { name: 'foto reduzida 0,6 (bilinear)', documentWidth: Math.ceil(width * 0.6), documentHeight: Math.ceil(height * 0.6), scale: 0.6, sampling: 'raster-bilinear' },
  { name: 'foto reduzida 0,25 (área)', documentWidth: Math.ceil(width / 4), documentHeight: Math.ceil(height / 4), scale: 0.25, sampling: 'raster-area' }
]

function packet(item: Case) {
  const backdrop: RustDocumentRasterLayer = { rgba: new Uint8Array([255, 255, 255, 255]), width: 1, height: 1, x: 0, y: 0,
    visible: true, opacity: 100, blendMode: 'normal', sourceToDocument: [item.documentWidth, 0, 0, item.documentHeight, 0, 0] }
  const layer: RustDocumentRasterLayer = { rgba: photo, width, height, x: 0, y: 0, visible: true, opacity: 80, blendMode: 'normal',
    sourceToDocument: [item.scale, 0, 0, item.scale, 0, 0], ...(item.sampling ? { sampling: item.sampling } : {}) }
  return encodeStyledDocument({ documentWidth: item.documentWidth, documentHeight: item.documentHeight,
    region: { x: 0, y: 0, width: 256, height: 256 }, resolutionScale: 1,
    outputGrid: { scaleX: 1, scaleY: 1, originX: 0, originY: 0 }, layersBottomToTop: [backdrop, layer] }, [null, null])
}

const report = []
for (const item of cases) {
  const runtime = await createRustPixelPocRuntime(wasm)
  try {
    const initial = runtime.memoryBytes
    let started = performance.now()
    const bytes = packet(item)
    const encodeMs = performance.now() - started
    const first = runtime.prepareDocumentPacket(bytes, 1)
    const afterPrepare = runtime.memoryBytes
    started = performance.now()
    let tiles = 0, kernelMs = 0
    for (let y = 0; y < item.documentHeight; y += 256) for (let x = 0; x < item.documentWidth; x += 256) {
      const tile = runtime.composePreparedDocument(first.documentId, { x, y,
        width: Math.min(256, item.documentWidth - x), height: Math.min(256, item.documentHeight - y) })
      kernelMs += tile.timings.kernelMs; tiles++
    }
    const composeMs = performance.now() - started
    // A edição seguinte: a sessão libera o documento antes de preparar outro (rustDocumentOffscreen.ts).
    let reprepare: string
    try {
      runtime.releaseDocument(first.documentId)
      const second = runtime.prepareDocumentPacket(bytes, 2)
      reprepare = `ok em ${second.preparationMs.toFixed(1)} ms`
    } catch (error) { reprepare = `recusado (${(error as { code?: string }).code ?? String(error)})` }
    report.push({ caso: item.name, pacoteMiB: +(bytes.length / MiB).toFixed(1), codificaMs: +encodeMs.toFixed(1),
      preparoMs: +first.preparationMs.toFixed(1), tiles, composicaoMs: +composeMs.toFixed(1), kernelMs: +kernelMs.toFixed(1),
      wasmInicialMiB: +(initial / MiB).toFixed(1), wasmAposPreparoMiB: +(afterPrepare / MiB).toFixed(1),
      wasmPicoMiB: +(runtime.memoryBytes / MiB).toFixed(1), segundoPreparo: reprepare })
  } catch (error) {
    report.push({ caso: item.name, erro: (error as { code?: string }).code ?? String(error) })
  } finally { runtime.dispose() }
}
console.log(JSON.stringify({ fonte: `${width}×${height}`, fonteMiB: +(photo.length / MiB).toFixed(1),
  node: process.version, plataforma: `${platform()} ${release()}`, cpu: cpus()[0]?.model, casos: report }, null, 2))
