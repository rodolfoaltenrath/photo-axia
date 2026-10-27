import { createLayerStyleConfig } from './layerStyles.ts'
import { disposeRustDocumentRenderer, renderRustDocumentCanvas, rustDocumentRendererStats } from '../services/rustDocumentRenderer.ts'
import type { DocumentSpec, LayerItem } from '../types/editor.ts'

/**
 * Foto de 12 MP pelo caminho completo do consumidor documental no WebView2 real: leitura
 * do Blob, decodificação no Worker, preparo no WASM e tiles. Mede tempo de parede e confere
 * pixels; memória JS/GPU do Worker não é observável daqui (ver rustDocumentBudget.ts).
 */
export async function runRustDocumentBudgetBenchmark() {
  const width = 4000, height = 3000
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('benchmark-canvas-unavailable')
  const gradient = context.createLinearGradient(0, 0, width, height)
  gradient.addColorStop(0, '#c02040'); gradient.addColorStop(0.5, '#20a060'); gradient.addColorStop(1, '#3040d0')
  context.fillStyle = gradient; context.fillRect(0, 0, width, height)
  context.fillStyle = '#f0e010'
  for (let index = 0; index < 400; index++) context.fillRect((index * 397) % width, (index * 211) % height, 37, 23)
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  // O PNG sem perdas permite conferir a saída 1:1 contra os pixels que o geraram.
  const expected = context.getImageData(0, 0, width, height).data
  canvas.width = 1; canvas.height = 1
  const url = URL.createObjectURL(blob)
  const document: DocumentSpec = { id: 'budget', name: 'budget', width, height, unit: 'px', physicalWidth: width,
    physicalHeight: height, resolutionDpi: 72, colorSpace: 'srgb', background: 'transparent', createdAt: '',
    layerStyleGlobalLight: { angle: 120, altitude: 30 } }
  const photo = (scale: number): LayerItem => ({ id: 'photo', name: 'Foto', visible: true, opacity: 100, blendMode: 'normal',
    kind: 'pixel', styles: createLayerStyleConfig(), image: { width, height, mimeType: 'image/png', sourceUrl: url, byteSize: blob.size },
    transform: { x: 0, y: 0, width: width * scale, height: height * scale, rotation: 0 } })
  const rows = []
  try {
    for (const [name, scale] of [['1:1', 1], ['1:1 reuso', 1], ['área 0,25', 0.25]] as const) {
      const outputWidth = width * scale, outputHeight = height * scale
      const before = rustDocumentRendererStats()
      const started = performance.now()
      let output: HTMLCanvasElement
      try {
        output = await renderRustDocumentCanvas({ ...document, width: outputWidth, height: outputHeight }, [photo(scale)],
          outputWidth, outputHeight, { x: 0, y: 0, width: outputWidth, height: outputHeight })
      } catch (error) {
        rows.push({ name, error: error instanceof Error ? error.message : String(error) }); continue
      }
      const wallMs = performance.now() - started
      const after = rustDocumentRendererStats()
      let mismatches = 0
      if (scale === 1) {
        const actual = output.getContext('2d')!.getImageData(0, 0, width, height).data
        for (let index = 0; index < actual.length; index++) if (actual[index] !== expected[index]) mismatches++
      }
      output.width = 1; output.height = 1
      rows.push({ name, outputWidth, outputHeight, wallMs: Math.round(wallMs), preparations: after.preparations - before.preparations,
        reuses: after.reuses - before.reuses, ...(scale === 1 ? { mismatchedBytes: mismatches } : {}) })
    }
  } finally {
    URL.revokeObjectURL(url)
    await disposeRustDocumentRenderer()
  }
  return { source: `${width}×${height} PNG`, encodedBytes: blob.size, decodedBytes: width * height * 4, rows }
}
