import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const errors = []

function read(path) {
  return readFileSync(resolve(root, path), 'utf8')
}

function expect(actual, expected, description) {
  if (actual !== expected) errors.push(`${description}: esperado ${expected}, encontrado ${actual ?? 'ausente'}`)
}

function versionInShell(path, name) {
  const pattern = new RegExp(`${name}="\\$\\{${name}:-([^}]+)\\}"`)
  return read(path).match(pattern)?.[1]
}

function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', shell: process.platform === 'win32' })
  if (result.error || result.status !== 0) return undefined
  return result.stdout.trim()
}

const go = read('go.mod').match(/^go (\S+)$/m)?.[1]
const wails = read('go.mod').match(/^\s*github\.com\/wailsapp\/wails\/v3 v(\S+)$/m)?.[1]
const node = read('.node-version').trim()
const rust = read('rust-toolchain.toml').match(/^channel = "([^"]+)"$/m)?.[1]
const manifest = JSON.parse(read('frontend/package.json'))
const lock = JSON.parse(read('frontend/package-lock.json'))
const npm = manifest.packageManager?.match(/^npm@(\d+\.\d+\.\d+)$/)?.[1]

if (!npm) errors.push('Versão exata do npm ausente em frontend/package.json (packageManager)')

expect(versionInShell('scripts/setup-go.sh', 'GO_VERSION'), go, 'Go em setup-go.sh')
expect(versionInShell('scripts/setup-go.sh', 'WAILS_VERSION'), `v${wails}`, 'Wails CLI em setup-go.sh')
expect(manifest.dependencies['@wailsio/runtime'], wails, 'Wails runtime em package.json')
expect(lock.packages['node_modules/@wailsio/runtime']?.version, wails, 'Wails runtime no lockfile')

for (const path of [
  'scripts/setup-node.sh', 'scripts/frontend-install.sh', 'scripts/frontend-dev.sh',
  'scripts/wails-build.sh', 'scripts/wails-dev.sh', 'scripts/flatpak-build.sh'
]) expect(versionInShell(path, 'NODE_VERSION'), node, `Node em ${path}`)

for (const path of ['scripts/wails-build.sh', 'scripts/wails-dev.sh', 'scripts/flatpak-build.sh']) {
  expect(versionInShell(path, 'GO_VERSION'), go, `Go em ${path}`)
}
if (!read('scripts/env.sh').includes(`.toolchains/go${go}/bin`)) errors.push('Go em scripts/env.sh não corresponde ao go.mod')
if (!read('scripts/env.sh').includes(`.toolchains/node-v${node}-linux-x64/bin`)) errors.push('Node em scripts/env.sh não corresponde ao .node-version')
if (!rust || !/^\d+\.\d+\.\d+$/.test(rust)) errors.push('Rust deve ter versão exata em rust-toolchain.toml')
if (!read('rust-toolchain.toml').includes('"wasm32-unknown-unknown"')) errors.push('Target WASM ausente em rust-toolchain.toml')

for (const [kind, packages] of Object.entries({ dependencies: manifest.dependencies, devDependencies: manifest.devDependencies })) {
  for (const [name, version] of Object.entries(packages)) {
    if (!/^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(version)) errors.push(`${name}: dependência direta não está fixada em versão exata`)
    expect(lock.packages[''][kind]?.[name], version, `${name} no lockfile raiz`)
    expect(lock.packages[`node_modules/${name}`]?.version, version, `${name} resolvido no lockfile`)
  }
}

if (process.argv.includes('--installed')) {
  expect(process.version, `v${node}`, 'Node instalado no PATH')
  expect(run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['--version']), npm, 'npm instalado no PATH')
  expect(run('go', ['version'])?.match(/\bgo(\d+\.\d+\.\d+)\b/)?.[1], go, 'Go instalado no PATH')
  expect(run('rustc', ['--version'])?.match(/^rustc (\d+\.\d+\.\d+)/)?.[1], rust, 'Rust instalado no PATH')
  expect(run('wails3', ['version'])?.match(/^v?(\S+)$/)?.[1], wails, 'Wails CLI instalado no PATH')
}

if (errors.length) {
  for (const error of errors) process.stderr.write(`- ${error}\n`)
  process.exitCode = 1
} else {
  process.stdout.write(`Toolchains consistentes: Go ${go}, Wails ${wails}, Node ${node}, npm ${npm}, Rust ${rust}.\n`)
}
