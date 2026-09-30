import { readFileSync } from 'node:fs'

// Reads one {id, expected} JSON object per line from stdin (or a file).
// No compositor code is imported: a Rust/WASM candidate can use this unchanged.
const fixture = JSON.parse(readFileSync(new URL('../tests/fixtures/layerStyleGoldens.v1.json', import.meta.url), 'utf8'))
const expected = new Map([...fixture.rasterCases, ...fixture.underlyingCases].map((item) => [item.id, item.expected]))
const input = readFileSync(process.argv[2] ?? 0, 'utf8')
const actual = new Map()
const errors = []

for (const [index, line] of input.split(/\r?\n/).entries()) {
  if (!line.trim()) continue
  let item
  try {
    item = JSON.parse(line)
  } catch {
    errors.push(`linha ${index + 1}: JSON inválido`)
    continue
  }
  if (!item || typeof item.id !== 'string' || !item.expected || typeof item.expected !== 'object') {
    errors.push(`linha ${index + 1}: esperado {id, expected}`)
  } else if (actual.has(item.id)) {
    errors.push(`linha ${index + 1}: id duplicado ${item.id}`)
  } else {
    actual.set(item.id, item.expected)
  }
}

for (const [id, golden] of expected) {
  const result = actual.get(id)
  if (!result) {
    errors.push(`${id}: resultado ausente`)
    continue
  }
  for (const key of ['width', 'height', 'offsetX', 'offsetY']) {
    if (key in golden && result[key] !== golden[key]) {
      errors.push(`${id}: ${key} esperado ${golden[key]}, recebido ${result[key]}`)
    }
  }
  if (!Array.isArray(result.rgba) || result.rgba.length !== golden.rgba.length) {
    errors.push(`${id}: comprimento RGBA esperado ${golden.rgba.length}, recebido ${result.rgba?.length ?? 'ausente'}`)
    continue
  }
  const firstMismatch = result.rgba.findIndex((value, index) => value !== golden.rgba[index])
  if (firstMismatch >= 0) {
    errors.push(`${id}: RGBA[${firstMismatch}] esperado ${golden.rgba[firstMismatch]}, recebido ${result.rgba[firstMismatch]}`)
  }
}
for (const id of actual.keys()) {
  if (!expected.has(id)) errors.push(`${id}: id desconhecido`)
}

if (errors.length) {
  for (const error of errors) console.error(error)
  process.exitCode = 1
} else {
  console.log(`${expected.size} casos RGBA idênticos aos goldens V${fixture.schemaVersion}.`)
}
