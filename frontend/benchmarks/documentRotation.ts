import wasmUrl from '../src/generated/axia_pixel_core.wasm?url'
import { rustRotationDifference, rustRotationPixelClasses, runRustDocumentRotationDiagnostic } from '../src/editor/rustDocumentRotationDiagnostic.ts'
import { rustDocumentSourceMatrix } from '../src/editor/rustDocumentEditorial.ts'
import { renderDocumentPNG } from '../src/services/renderDocument.ts'
import { disposeRustDocumentRenderer } from '../src/services/rustDocumentRenderer.ts'
import { createDefaultLayerEffect, createLayerStyleConfig } from '../src/editor/layerStyles.ts'
import { DEFAULT_TEXT_LAYER } from '../src/editor/text.ts'
import type { DocumentSpec, LayerItem } from '../src/types/editor.ts'

async function pixels(dataUrl: string, width: number, height: number) {
  const image = new Image(); image.src = dataUrl; await image.decode()
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(image, 0, 0)
  return context.getImageData(0, 0, width, height).data
}

/** Documento inteiro pelo app: exportação legada contra o consumidor Rust, com rotação arbitrária. */
async function compareEditorialRotation() {
  const width = 64, height = 48, original = location.href, enabled = new URL(original)
  enabled.searchParams.set('axiaRustDocument', '1')
  const spec: DocumentSpec = { id: 'rotation', name: 'rotation', width, height, unit: 'px', physicalWidth: width,
    physicalHeight: height, resolutionDpi: 72, colorSpace: 'srgb', background: 'white', createdAt: '',
    layerStyleGlobalLight: { angle: 120, altitude: 30 } }
  const source = new OffscreenCanvas(12, 8), context = source.getContext('2d')!
  const gradient = context.createLinearGradient(0, 0, 12, 8)
  gradient.addColorStop(0, '#c02040'); gradient.addColorStop(1, '#2040d0')
  context.fillStyle = gradient; context.fillRect(0, 0, 12, 8)
  const reader = new FileReader(), blob = await source.convertToBlob({ type: 'image/png' })
  const sourceUrl = await new Promise<string>(resolve => { reader.onload = () => resolve(String(reader.result)); reader.readAsDataURL(blob) })
  const base = (id: string, kind: LayerItem['kind'], content: Partial<LayerItem>, rotation: number, blendMode: LayerItem['blendMode'],
    effects: string[]): LayerItem => ({ id, name: id, kind, visible: true, opacity: 80, blendMode,
    styles: { ...createLayerStyleConfig(), effects: effects.map(type => createDefaultLayerEffect(type as never)) },
    transform: { x: 14.25, y: 12.5, width: 30, height: 20, rotation }, ...content })
  const cases = [
    { id: 'imagem 37°', layer: base('image', 'pixel', { image: { width: 12, height: 8, mimeType: 'image/png', sourceUrl } }, 37, 'normal', []), sourceSize: [12, 8] },
    { id: 'imagem -112° com sombra', layer: base('image-shadow', 'pixel', { image: { width: 12, height: 8, mimeType: 'image/png', sourceUrl } }, -112, 'multiply', ['drop-shadow']), sourceSize: [12, 8] },
    { id: 'texto 23° com contorno', layer: base('text', 'text', { text: { ...DEFAULT_TEXT_LAYER, content: 'Axia', fontFamily: 'Arial, sans-serif',
      fontSize: 16, color: '#e04090', baseWidth: 30, baseHeight: 20 } }, 23, 'normal', ['stroke']), sourceSize: [30, 20] }
  ]
  const worst = { interiorAlpha: 0, interiorColor: 0, edgeAlpha: 0, edgeColor: 0, outsideAlpha: 0, outsideColor: 0 }
  try {
    for (const item of cases) {
      const layers = [item.layer, { id: 'background', name: 'background', kind: 'background', visible: true, opacity: 100,
        blendMode: 'normal', styles: createLayerStyleConfig() } as LayerItem]
      history.replaceState(null, '', original)
      const expected = await pixels(await renderDocumentPNG(spec, layers), width, height)
      history.replaceState(null, '', enabled)
      const actual = await pixels(await renderDocumentPNG(spec, layers), width, height)
      const backend = JSON.parse(document.documentElement.dataset.axiaRustDocument || '{}')
      if (backend.backend !== 'rust') throw new Error(`${item.id} em fallback: ${JSON.stringify(backend)}`)
      const [sourceWidth, sourceHeight] = item.sourceSize as [number, number]
      const classes = rustRotationPixelClasses(rustDocumentSourceMatrix(item.layer.transform!, sourceWidth, sourceHeight),
        sourceWidth, sourceHeight, width, height)
      const difference = rustRotationDifference(expected, actual, classes)
      for (const key of Object.keys(worst) as (keyof typeof worst)[]) worst[key] = Math.max(worst[key], difference[key])
      if (difference.interiorAlpha > 2 || difference.interiorColor > 3 ||
          Math.max(difference.edgeAlpha, difference.outsideAlpha) > 12 || Math.max(difference.edgeColor, difference.outsideColor) > 16) {
        throw new Error(`${item.id}: ${JSON.stringify(difference)}`)
      }
    }
    return { cases: cases.length, worst }
  } finally { await disposeRustDocumentRenderer(); history.replaceState(null, '', original) }
}

const result = document.querySelector('#result')!
try {
  const wasm = await (await fetch(wasmUrl)).arrayBuffer()
  const kernel = await runRustDocumentRotationDiagnostic(wasm)
  const editorial = await compareEditorialRotation()
  result.textContent = JSON.stringify({ status: 'pass', kernel, editorial })
} catch (error) { result.textContent = JSON.stringify({ status: 'error', message: String(error) }) }
