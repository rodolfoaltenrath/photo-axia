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
const { instance } = await WebAssembly.instantiate(bundled, {})
assert.equal(instance.exports.axia_poc_document_region?.length, 4, 'Assinatura da pilha documental incompatível')
assert.equal(instance.exports.axia_poc_document_packet_version?.(), 2, 'Versão da pilha documental incompatível')
assert.equal(instance.exports.axia_poc_style_stages_region?.length, 12, 'Assinatura dos estágios incompatível')
assert.equal(instance.exports.axia_poc_bevel_region?.length, 14, 'Assinatura do bisel incompatível')
assert.equal(instance.exports.axia_poc_drop_shadow_region?.length, 14, 'Assinatura da sombra externa incompatível')
assert.equal(instance.exports.axia_poc_inner_shadow_region?.length, 14, 'Assinatura da sombra interna incompatível')
assert.equal(instance.exports.axia_poc_glow_region?.length, 14, 'Assinatura dos brilhos incompatível')
assert.equal(instance.exports.axia_poc_satin_region?.length, 14, 'Assinatura do acetinado incompatível')
assert.equal(instance.exports.axia_poc_stroke_region?.length, 14, 'Assinatura do traçado incompatível')
assert.equal(instance.exports.axia_poc_alpha_mask_region?.length, 13, 'Assinatura da máscara com halo incompatível')
assert.equal(instance.exports.axia_poc_local_batch_region?.length, 12, 'Assinatura do lote local incompatível')
assert.equal(instance.exports.axia_poc_gradient_overlay_region?.length, 24,
  'A assinatura do gradiente deve corresponder ao adapter atual')

function reachableJavaScript(start) {
  const seen = new Set(), pending = [start], texts = []
  while (pending.length) {
    const name = pending.pop()
    if (seen.has(name)) continue
    seen.add(name)
    const source = readFileSync(join(assetsRoot, name), 'utf8')
    texts.push(source)
    for (const dependency of names) if (dependency.endsWith('.js') && source.includes(dependency) && !seen.has(dependency)) pending.push(dependency)
  }
  return texts.join('\n')
}
const diagnostic = reachableJavaScript(diagnosticName)
assert.ok(diagnostic.includes(wasmName), 'O diagnóstico deve apontar ao WASM com hash')
assert.ok(diagnostic.includes(workerName), 'O diagnóstico deve apontar ao Worker com hash')
const previewName = exactlyOne('rustLayerStylePreview-', '.js')
const preview = reachableJavaScript(previewName)
assert.ok(preview.includes(wasmName) && preview.includes(workerName), 'Preview opt-in deve alcançar o WASM/Worker local')
const html = readFileSync(join(frontendRoot, 'dist', 'index.html'), 'utf8')
assert.ok(!html.includes(wasmName) && !html.includes(workerName) && !html.includes(previewName),
  'HTML padrão não deve carregar/precarregar o runtime experimental')
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('axia_poc_fill_opacity'))
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('compose-document-region'),
  'O Worker deve incluir a pilha documental privada')
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('axia_poc_blend_if_underlying_region'))
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('axia_poc_blend_if_this_layer_region'))
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('axia_poc_color_overlay_region'))
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('axia_poc_pattern_overlay_region'))
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('axia_poc_gradient_overlay_region'))
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('stage-style-source'),
  'O Worker deve incluir preparação da fonte original')
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('stage-style-media'),
  'O Worker deve incluir decode de imagem/texto')
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('style-media-staged-region'),
  'O Worker deve incluir decode de assets e execução regional')
assert.ok(readFileSync(join(assetsRoot, workerName), 'utf8').includes('style-media-staged-png'),
  'O Worker deve incluir codificação PNG após o pipeline Rust')
assert.ok(names.some((name) => name.startsWith('index-') && name.endsWith('.js') &&
  readFileSync(join(assetsRoot, name), 'utf8').includes(diagnosticName)),
  'O ponto de entrada deve referenciar o chunk diagnóstico')

process.stdout.write(`Pacote Rust POC íntegro: ${wasmName} (${bundled.length} bytes), ${workerName}.\n`)
