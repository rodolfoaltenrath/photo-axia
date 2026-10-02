import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const assetsRoot = join(frontendRoot, 'dist', 'assets')
const names = readdirSync(assetsRoot)
function exactlyOne(prefix, suffix) {
  const matches = names.filter((name) => name.startsWith(prefix) && name.endsWith(suffix))
  assert.equal(matches.length, 1, `Esperado um artefato ${prefix}*${suffix}; encontrados: ${matches}`)
  return matches[0]
}

const wasmName = exactlyOne('axia_pixel_core-', '.wasm')
const workerName = exactlyOne('rustPixelPoc.worker-', '.js')
const diagnosticName = exactlyOne('rustPixelPocDiagnostic-', '.js')
const generated = readFileSync(join(frontendRoot, 'src', 'generated', 'axia_pixel_core.wasm'))
const bundled = readFileSync(join(assetsRoot, wasmName))
assert.deepEqual(bundled, generated, 'Vite deve empacotar os bytes gerados pelo Cargo sem alteração')

const diagnostic = readFileSync(join(assetsRoot, diagnosticName), 'utf8')
assert.ok(diagnostic.includes(wasmName), 'O diagnóstico deve apontar ao WASM com hash')
assert.ok(diagnostic.includes(workerName), 'O diagnóstico deve apontar ao Worker com hash')
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('axia_poc_fill_opacity'))
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('axia_poc_blend_if_underlying_region'))
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('axia_poc_blend_if_this_layer_region'))
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('axia_poc_color_overlay_region'))
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('axia_poc_pattern_overlay_region'))
assert.ok(names.some((name) => name.startsWith('index-') && name.endsWith('.js') &&
  readFileSync(join(assetsRoot, name), 'utf8').includes(diagnosticName)),
  'O ponto de entrada deve referenciar o chunk diagnóstico')

process.stdout.write(`Pacote Rust POC íntegro: ${wasmName} (${bundled.length} bytes), ${workerName}.\n`)
