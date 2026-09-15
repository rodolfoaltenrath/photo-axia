import { createApp } from 'vue'
import { installDesktopInteractionGuards } from './editor/interactionGuards'
import './style.css'

async function bootstrap() {
  installDesktopInteractionGuards()
  const nativeWindow = new URLSearchParams(window.location.search).get('window')
  const component = nativeWindow === 'layer-styles'
    ? (await import('./LayerStyleWindow.vue')).default
    : (await import('./App.vue')).default
  createApp(component).mount('#app')
}

void bootstrap()
