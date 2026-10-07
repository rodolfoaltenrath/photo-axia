import { createApp } from 'vue'
import { installDesktopInteractionGuards } from './editor/interactionGuards'
import './style.css'

async function bootstrap() {
  installDesktopInteractionGuards()
  const params = new URLSearchParams(window.location.search)
  const nativeWindow = params.get('window')
  const component = nativeWindow === 'layer-styles'
    ? (await import('./LayerStyleWindow.vue')).default
    : (await import('./App.vue')).default
  createApp(component).mount('#app')

  // Separate ABI diagnostic; not the opt-in style preview.
  if (params.get('axiaRustPoc') === '1') {
    void import('./editor/rustPixelPocDiagnostic.ts')
      .then(({ runRustPixelPocDiagnostic }) => runRustPixelPocDiagnostic())
      .then(async (result) => {
        document.documentElement.dataset.axiaRustPocWasmBytes = String(result.wasmBytes)
        if (params.get('axiaRustMediaBenchmark') === '1') {
          const { runRustStyleMediaBenchmark } = await import('./editor/rustStyleMediaBenchmark.ts')
          document.documentElement.dataset.axiaRustMediaBenchmark = JSON.stringify(await runRustStyleMediaBenchmark())
        }
        document.documentElement.dataset.axiaRustPoc = 'passed'
        console.info('Axia Rust POC:', result)
      })
      .catch((error: unknown) => {
        document.documentElement.dataset.axiaRustPoc = 'failed'
        document.documentElement.dataset.axiaRustPocError = error instanceof Error ? error.message.slice(0, 160) : 'unknown'
        console.error('Axia Rust POC failed:', error)
      })
  }
}

void bootstrap()
