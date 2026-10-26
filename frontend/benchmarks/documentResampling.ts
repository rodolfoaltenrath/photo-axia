import wasmUrl from '../src/generated/axia_pixel_core.wasm?url'
import { runRustDocumentResamplingDiagnostic } from '../src/editor/rustDocumentResamplingDiagnostic.ts'

const result = document.querySelector('#result')!
try {
  const measurement = await runRustDocumentResamplingDiagnostic(await (await fetch(wasmUrl)).arrayBuffer())
  result.textContent = JSON.stringify({ status: 'pass', ...measurement })
} catch (error) { result.textContent = JSON.stringify({ status: 'error', message: String(error) }) }
