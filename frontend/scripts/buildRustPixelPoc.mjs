import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const repoRoot = resolve(frontendRoot, '..')
const manifest = join(repoRoot, 'rust', 'axia-pixel-core', 'Cargo.toml')
const builtWasm = join(repoRoot, 'rust', 'axia-pixel-core', 'target', 'wasm32-unknown-unknown', 'release', 'axia_pixel_core.wasm')
const generatedDir = join(frontendRoot, 'src', 'generated')
const bundledWasm = join(generatedDir, 'axia_pixel_core.wasm')
const cargoName = process.platform === 'win32' ? 'cargo.exe' : 'cargo'
const cargoFallback = process.platform === 'win32'
  ? process.env.USERPROFILE && join(process.env.USERPROFILE, '.cargo', 'bin', cargoName)
  : process.env.HOME && join(process.env.HOME, '.cargo', 'bin', cargoName)
const cargo = cargoFallback && existsSync(cargoFallback) ? cargoFallback : cargoName

const result = spawnSync(cargo, [
  'build', '--offline', '--locked', '--release', '--target', 'wasm32-unknown-unknown',
  '--manifest-path', manifest
], { cwd: repoRoot, stdio: 'inherit' })
if (result.error) {
  throw new Error(`Cargo indisponível: ${result.error.message}. Instale a toolchain de rust-toolchain.toml.`)
}
if (result.status !== 0) process.exit(result.status ?? 1)
if (!existsSync(builtWasm) || statSync(builtWasm).size === 0) {
  throw new Error('Cargo concluiu sem produzir o WASM esperado.')
}
mkdirSync(generatedDir, { recursive: true })
copyFileSync(builtWasm, bundledWasm)
process.stdout.write(`WASM local pronto para o Vite (${statSync(bundledWasm).size} bytes).\n`)
