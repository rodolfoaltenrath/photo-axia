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

  // Explicit diagnostic only. Normal editing never starts the Rust POC Worker.
  if (params.get('axiaRustPoc') === '1') {
    void import('./editor/rustPixelPocDiagnostic.ts')
      .then(({ runRustPixelPocDiagnostic }) => runRustPixelPocDiagnostic())
      .then((result) => {
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
