import { createApp } from 'vue'
import { Events } from '@wailsio/runtime'
import { installDesktopInteractionGuards } from './editor/interactionGuards'
import './style.css'

const FRONTEND_READY_EVENT = 'axia:frontend-ready'

function isDesktopRuntime() {
  return Boolean((window as typeof window & { _wails?: unknown })._wails)
}

function waitForInitialPaint() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

async function bootstrap() {
  installDesktopInteractionGuards()
  const nativeWindow = new URLSearchParams(window.location.search).get('window')
  const component = nativeWindow === 'layer-styles'
    ? (await import('./LayerStyleWindow.vue')).default
    : (await import('./App.vue')).default
  createApp(component).mount('#app')

  // The main native window starts hidden so WebView2 cannot briefly expose a
  // previous frame. This is deliberately sent only after Vue replaced the
  // static shell with the initial ProjectHome screen.
  if (nativeWindow !== 'layer-styles' && isDesktopRuntime()) {
    await waitForInitialPaint()
    void Events.Emit(FRONTEND_READY_EVENT, null).catch(() => {
      // Go has an independent timeout fallback to keep the window reachable.
    })
  }
}

void bootstrap()
