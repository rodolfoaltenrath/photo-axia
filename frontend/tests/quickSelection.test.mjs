import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeQuickSelectionOptions,
  quickSelectionSpans,
  quickSelectionSpansCooperatively
} from '../src/editor/quickSelection.ts'

function rgba(width, rows) {
  const pixels = new Uint8ClampedArray(width * rows.length * 4)
  rows.flat().forEach(([red, green, blue, alpha], index) => pixels.set([red, green, blue, alpha], index * 4))
  return pixels
}

test('cresce dentro de um objeto e para na borda de alto contraste', () => {
  const pixels = rgba(5, [
    [[10, 20, 220, 255], [10, 20, 220, 255], [240, 240, 240, 255], [240, 240, 240, 255], [240, 240, 240, 255]],
    [[10, 20, 220, 255], [10, 20, 220, 255], [240, 240, 240, 255], [240, 240, 240, 255], [240, 240, 240, 255]]
  ])

  const result = quickSelectionSpans(pixels, 5, 2, {
    positiveSeeds: [{ x: 0, y: 0 }], colorTolerance: 255, edgeTolerance: 32
  })

  assert.deepEqual(result.spans, [{ y: 0, x0: 0, x1: 2 }, { y: 1, x0: 0, x1: 2 }])
  assert.deepEqual(result.bounds, { x: 0, y: 0, width: 2, height: 2 })
})

test('atravessa gradiente suave e ainda respeita a borda forte', () => {
  const pixels = rgba(5, [[
    [20, 20, 20, 255], [35, 35, 35, 255], [50, 50, 50, 255], [220, 220, 220, 255], [220, 220, 220, 255]
  ]])

  const result = quickSelectionSpans(pixels, 5, 1, {
    positiveSeeds: [{ x: 0, y: 0 }], colorTolerance: 255, edgeTolerance: 30
  })

  assert.deepEqual(result.spans, [{ y: 0, x0: 0, x1: 3 }])
})

test('sementes negativas impedem a inclusão dos pixels indicados', () => {
  const pixels = rgba(5, [[
    [80, 120, 160, 255], [80, 120, 160, 255], [80, 120, 160, 255], [80, 120, 160, 255], [80, 120, 160, 255]
  ]])

  const result = quickSelectionSpans(pixels, 5, 1, {
    positiveSeeds: [{ x: 0, y: 0 }], negativeSeeds: [{ x: 3, y: 0 }], colorTolerance: 0, edgeTolerance: 0
  })

  assert.deepEqual(result.spans, [{ y: 0, x0: 0, x1: 3 }])
  assert.equal(result.pixelCount, 3)
})

test('normaliza os controles separados de cor e borda', () => {
  assert.deepEqual(
    normalizeQuickSelectionOptions({
      positiveSeeds: [{ x: 1.8, y: 0.2 }], colorTolerance: 999, edgeTolerance: -1
    }, 3, 2),
    {
      positiveSeeds: [{ x: 1, y: 0 }],
      negativeSeeds: [],
      colorTolerance: 255,
      edgeTolerance: 0
    }
  )
})

test('recusa buffers incompletos e sementes fora da imagem', () => {
  assert.equal(quickSelectionSpans(new Uint8ClampedArray(3), 1, 1, { positiveSeeds: [{ x: 0, y: 0 }] }).pixelCount, 0)
  assert.equal(quickSelectionSpans(new Uint8ClampedArray(4), 1, 1, { positiveSeeds: [{ x: 4, y: 4 }] }).pixelCount, 0)
})

test('fallback cooperativo produz exatamente a máscara do núcleo síncrono', async () => {
  const pixels = rgba(4, [
    [[20, 20, 20, 255], [35, 35, 35, 255], [50, 50, 50, 255], [220, 220, 220, 255]],
    [[20, 20, 20, 255], [35, 35, 35, 255], [50, 50, 50, 255], [220, 220, 220, 255]]
  ])
  const options = { positiveSeeds: [{ x: 0, y: 0 }], colorTolerance: 255, edgeTolerance: 30 }
  assert.deepEqual(
    await quickSelectionSpansCooperatively(pixels, 4, 2, options, {
      pixelsPerChunk: 1,
      yieldControl: async () => {}
    }),
    quickSelectionSpans(pixels, 4, 2, options)
  )
})

test('fallback cooperativo interrompe o crescimento entre lotes', async () => {
  const width = 300
  const pixels = new Uint8ClampedArray(width * 4)
  for (let x = 0; x < width; x++) pixels[x * 4 + 3] = 255
  let cancelled = false
  await assert.rejects(
    quickSelectionSpansCooperatively(
      pixels,
      width,
      1,
      { positiveSeeds: [{ x: 0, y: 0 }], colorTolerance: 0, edgeTolerance: 0 },
      {
        pixelsPerChunk: 4,
        throwIfCancelled: () => {
          if (cancelled) throw new DOMException('Seleção cancelada.', 'AbortError')
        },
        yieldControl: async () => { cancelled = true }
      }
    ),
    { name: 'AbortError' }
  )
})
