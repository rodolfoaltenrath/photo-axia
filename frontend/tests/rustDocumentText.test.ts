import assert from 'node:assert/strict'
import test from 'node:test'
import { planRustEditorialDocument, RustDocumentUnsupported } from '../src/editor/rustDocumentEditorial.ts'
import { drawRustDocumentText, planRustDocumentText, rustDocumentTextFontsReady,
  validateRustDocumentTextPixels, type RustDocumentTextCanvas, type RustDocumentTextPixels } from '../src/editor/rustDocumentText.ts'
import { DEFAULT_TEXT_LAYER } from '../src/editor/text.ts'
import { createDefaultLayerEffect } from '../src/editor/layerStyles.ts'
import { layer, transform, styles } from './editorTestFixtures.ts'
import type { DocumentSpec, TextLayerContent } from '../src/types/editor.ts'

const document: DocumentSpec = { id: 'doc', name: 'doc', width: 8, height: 6, unit: 'px',
  physicalWidth: 8, physicalHeight: 6, resolutionDpi: 72, colorSpace: 'srgb', background: 'transparent',
  createdAt: '', layerStyleGlobalLight: { angle: 120, altitude: 30 } }
const viewport = { x: 0, y: 0, width: 8, height: 6 }
const content = (overrides: Partial<TextLayerContent> = {}): TextLayerContent =>
  ({ ...DEFAULT_TEXT_LAYER, content: 'Ab', fontFamily: 'Arial', fontSize: 10, baseWidth: 20, baseHeight: 12, ...overrides })
const textLayer = (overrides = {}) => layer({ id: 'caption', kind: 'text', text: content(),
  transform: transform({ x: 1.25, y: 0.5, width: 4, height: 2.4 }), ...overrides })

test('texto Normal sem estilos entra no plano como descritor 1:1 com opacidade incorporada', () => {
  const item = textLayer({ opacity: 63.7 })
  const plan = planRustEditorialDocument(document, [item], 8, 6, viewport)
  const entry = plan.layers[0]!
  if (entry.source.type !== 'text') throw new Error('descritor de texto ausente')
  assert.deepEqual([entry.source.originX, entry.source.originY, entry.source.width, entry.source.height], [1, 0, 5, 3])
  assert.deepEqual(entry.matrix, [1, 0, 0, 1, 1, 0])
  assert.equal(entry.opacity, 100); assert.equal(entry.blendMode, 'normal')
  assert.ok(Math.abs(entry.source.alpha - 0.637) < 1e-12)
  assert.equal(entry.input.sourceIdentity, 'text:caption')
  assert.equal(entry.input.sourceWidth, 5); assert.equal(entry.sampling, undefined)
  // O plano é um snapshot: editar a camada depois não altera o descritor nem a identidade de reuso.
  item.text!.content = 'mudou'; item.transform!.x = 7
  assert.equal(entry.source.text.content, 'Ab'); assert.equal(entry.source.transform.x, 1.25)
})

test('estilo, Fill e Blend If mantêm o texto no fallback explícito; modos de mesclagem entram', () => {
  const effect = createDefaultLayerEffect('drop-shadow')
  for (const [overrides, reason] of [
    [{ styles: styles({ fillOpacity: 50 }) }, 'text-style'],
    [{ styles: styles({ effects: [effect] }) }, 'text-style']
  ] as const) {
    assert.throws(() => planRustEditorialDocument(document, [textLayer(overrides)], 8, 6, viewport),
      (error: unknown) => error instanceof RustDocumentUnsupported && error.reason === reason)
  }
  const blendIf = styles(); blendIf.blendIf.thisLayer.shadows = [10, 10]
  assert.throws(() => planRustEditorialDocument(document, [textLayer({ styles: blendIf })], 8, 6, viewport), /text-style/)
  // Mesclado uma vez sobre o fundo, como o preview: o modo vai no registro, a opacidade no raster.
  for (const blendMode of ['multiply', 'screen', 'overlay', 'darken', 'lighten'] as const) {
    const entry = planRustEditorialDocument(document, [textLayer({ blendMode, opacity: 40 })], 8, 6, viewport).layers[0]!
    assert.equal(entry.blendMode, blendMode); assert.equal(entry.opacity, 100)
  }
})

test('fonte declarada ainda carregando bloqueia o plano em vez de congelar um fallback na sessão', () => {
  const pending = { check: () => false }, ready = { check: () => true }, broken = { check: () => { throw new SyntaxError('font') } }
  assert.equal(rustDocumentTextFontsReady(content(), pending), false)
  assert.equal(rustDocumentTextFontsReady(content(), ready), true)
  assert.equal(rustDocumentTextFontsReady(content(), broken), false)
  assert.equal(rustDocumentTextFontsReady(content(), undefined), true)
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { fonts: pending } })
  try {
    assert.throws(() => planRustEditorialDocument(document, [textLayer()], 8, 6, viewport), /text-font-pending/)
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous)
    else delete (globalThis as { document?: unknown }).document
  }
})

test('bounds de texto são inteiros, recortados no documento e deslocados na aparência', () => {
  const outside = planRustDocumentText(content(), { x: -3.5, y: 4.2, width: 6, height: 3, rotation: 0 }, 8, 6, 1)!
  assert.deepEqual([outside.originX, outside.originY, outside.width, outside.height], [0, 4, 3, 2])
  assert.equal(planRustDocumentText(content(), { x: 20, y: 0, width: 2, height: 2, rotation: 0 }, 8, 6, 1), null)
  const appearance = planRustEditorialDocument(document, [textLayer()], 5, 3, { x: 1, y: 0, width: 5, height: 3 }, 'appearance')
  const source = appearance.layers[0]!.source
  if (source.type !== 'text') throw new Error('descritor de texto ausente')
  assert.equal(source.transform.x, 0.25); assert.equal(source.originX, 0)
  for (const bad of [content({ fontSize: 0 }), content({ baseWidth: Number.NaN }), content({ fontFamily: '' }), content({ content: 1 as never })]) {
    assert.throws(() => planRustDocumentText(bad, { x: 0, y: 0, width: 2, height: 2 }, 8, 6, 1), /invalid-input/)
  }
  assert.throws(() => planRustDocumentText(content(), { x: 0, y: 0, width: 5000, height: 5000 }, 4096, 4096, 1), /memory-limit/)
})

function recordingCanvas(calls: unknown[][], fail = false): RustDocumentTextCanvas {
  return (width, height) => {
    const record = (name: string) => (...args: unknown[]) => { calls.push([name, ...args]) }
    const context = {
      set globalAlpha(value: number) { calls.push(['globalAlpha', value]) },
      set font(value: string) { calls.push(['font', value]) },
      fillStyle: '', textAlign: '', textBaseline: '', letterSpacing: '',
      save: record('save'), restore: record('restore'), translate: record('translate'), rotate: record('rotate'),
      scale: record('scale'), beginPath: record('beginPath'), rect: record('rect'), clip: record('clip'),
      fillRect: record('fillRect'),
      fillText: (...args: unknown[]) => { calls.push(['fillText', ...args]); if (fail) throw new Error('raster-failed') },
      measureText: (line: string) => ({ width: line.length * 5 }),
      getImageData: () => ({ width, height, data: new Uint8ClampedArray(width * height * 4) })
    }
    return { context: context as unknown as CanvasRenderingContext2D, release: () => { calls.push(['release']) } }
  }
}

test('rasterização reproduz a sequência do legado deslocada pela origem inteira (Canvas double)', () => {
  const source = planRustDocumentText(content({ decoration: 'underline' }),
    { x: 1.25, y: 0.5, width: 4, height: 2.4, rotation: 90 }, 8, 6, 0.5)!
  const calls: unknown[][] = []
  const pixels = drawRustDocumentText(source, recordingCanvas(calls))
  const cx = 1.25 + 2 - source.originX, cy = 0.5 + 1.2 - source.originY
  assert.deepEqual(calls.slice(0, 8), [
    ['globalAlpha', 0.5], ['translate', cx, cy], ['rotate', Math.PI / 2], ['scale', 4 / 20, 2.4 / 12],
    ['translate', -10, -6], ['beginPath'], ['rect', 0, 0, 20, 12], ['clip']
  ])
  assert.ok(calls.some(call => call[0] === 'fillText' && call[1] === 'Ab'))
  assert.ok(calls.some(call => call[0] === 'fillRect'), 'sublinhado desenhado pelo mesmo caminho do legado')
  assert.deepEqual(calls.at(-1), ['release'])
  assert.equal(pixels.type, 'text-pixels'); assert.ok(pixels.rgba instanceof ArrayBuffer)
  assert.equal(pixels.rgba.byteLength, source.width * source.height * 4)
  assert.deepEqual([pixels.originX, pixels.originY], [source.originX, source.originY])
})

test('falha de rasterização libera o canvas temporário', () => {
  const source = planRustDocumentText(content(), { x: 0, y: 0, width: 4, height: 2 }, 8, 6, 1)!
  const calls: unknown[][] = []
  assert.throws(() => drawRustDocumentText(source, recordingCanvas(calls, true)), /raster-failed/)
  assert.deepEqual(calls.at(-1), ['release'])
})

test('Worker não confia em geometria nem tamanho do buffer de texto recebido', () => {
  const valid: RustDocumentTextPixels = { type: 'text-pixels', width: 2, height: 1, originX: 3, originY: 2, rgba: new ArrayBuffer(8) }
  validateRustDocumentTextPixels(valid, 8, 6)
  for (const mutate of [
    (s: RustDocumentTextPixels) => { s.rgba = new ArrayBuffer(4) },
    (s: RustDocumentTextPixels) => { s.rgba = new Uint8Array(8) as unknown as ArrayBuffer },
    (s: RustDocumentTextPixels) => { s.originX = 7 },
    (s: RustDocumentTextPixels) => { s.originY = -1 },
    (s: RustDocumentTextPixels) => { s.width = 2.5 },
    (s: RustDocumentTextPixels) => { s.height = 0 }
  ]) {
    const source = { ...valid }; mutate(source)
    assert.throws(() => validateRustDocumentTextPixels(source, 8, 6), /invalid-input/)
  }
})
