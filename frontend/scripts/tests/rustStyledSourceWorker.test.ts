import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { composeLayerStyleRaster } from '../../src/editor/layerStyleRaster.ts'
import { createLayerStyleBlendIf, normalizeLayerStyleConfig } from '../../src/editor/layerStyles.ts'
import { RustPixelPocPreviewObserver } from '../../src/editor/rustPixelPocPreviewObserver.ts'
import { styledRasterPreviewSnapshot } from '../../src/editor/rustPixelPocStyledSource.ts'
import { RustPixelPocTileGate } from '../../src/editor/rustPixelPocTileGate.ts'
import { createRustPixelWorkerHarness } from './support/rustPixelWorkerHarness.ts'

test('Worker recebe fonte estilizada após invalidar, reusa faixas e rejeita edições ultrapassadas', async () => {
  const harness = createRustPixelWorkerHarness()
  const { send } = harness
  const document = { id: 'doc', width: 3, height: 1, background: 'transparent' as const,
    colorSpace: 'srgb' as const, resolutionDpi: 72, layerStyleGlobalLight: { angle: 30, altitude: 30 } }
  const viewport = { scale: 1, devicePixelRatio: 1, scrollLeft: 0, scrollTop: 0,
    width: 800, height: 600, stackKey: 'stack' }
  const identity = { contentKey: 'source-1', assetKey: '', width: 3, height: 1,
    offsetX: 0, offsetY: 0, resolutionScale: 1, quality: 'final' as const }
  const source = { width: 3, height: 1, data: new Uint8ClampedArray([5, 8, 9, 101, 0, 0, 0, 255, 2, 3, 4, 0]) }
  const styles = (color: string, shadows: [number, number] = [50, 100]) =>
    normalizeLayerStyleConfig({ fillOpacity: 0, effects: [{ type: 'color-overlay', id: 'color', color }],
      blendIf: { channel: 'red', thisLayer: { shadows, highlights: [255, 255] } } })
  const snapshot = (color: string, shadows?: [number, number], contentKey = identity.contentKey) =>
    styledRasterPreviewSnapshot(document,
      { id: 'layer', kind: 'pixel', visible: true, opacity: 100, blendMode: 'normal', styles: styles(color, shadows) },
      undefined, viewport, { ...identity, contentKey })
  const prepare = (color: string) => new Uint8Array(composeLayerStyleRaster(source,
    { ...styles(color), blendIf: createLayerStyleBlendIf() }, document.layerStyleGlobalLight).data)
  const region = { x: 0, y: 0, width: 3, height: 1 }
  const blendIf = { channel: 'red' as const, shadows: [50, 100] as [number, number],
    highlights: [255, 255] as [number, number] }
  const gate = new RustPixelPocTileGate()
  const observer = new RustPixelPocPreviewObserver(gate)
  try {
    const wasm = Uint8Array.from(readFileSync(new URL(
      '../../../rust/axia-pixel-core/target/wasm32-unknown-unknown/release/axia_pixel_core.wasm', import.meta.url
    ))).buffer
    assert.equal((await send({ type: 'init', wasm }, [wasm])).type, 'ready')
    const first = observer.observe(snapshot('#4b141e'))
    assert.ok(first.kind === 'source')
    assert.equal((await send({ type: 'invalidate-source', generation: first.generation })).type, 'source-invalidated')
    const pixels = prepare('#4b141e')
    const staged = await send({ type: 'stage-source', rgba: pixels.buffer, sourceWidth: 3,
      sourceHeight: 1, generation: first.generation }, [pixels.buffer])
    assert.equal(pixels.byteLength, 0)
    assert.ok(staged.type === 'source-staged' && gate.adoptSource(staged))
    const request = send({ type: 'blend-if-this-layer-staged-region', sourceId: staged.sourceId, region, blendIf })
    const token = gate.captureTile('tile', request.id)
    assert.ok(token)
    const result = await request
    assert.ok(token.isCurrent(result))
    assert.equal(result.timings.copyInMs, 0)
    assert.deepEqual(new Uint8Array(result.rgba), new Uint8Array(composeLayerStyleRaster(source,
      styles('#4b141e'), document.layerStyleGlobalLight).data))

    assert.deepEqual(observer.observe(snapshot('#4b141e', [0, 0])), { kind: 'view' })
    assert.equal(token.isCurrent(result), false)
    const reused = send({ type: 'blend-if-this-layer-staged-region', sourceId: staged.sourceId, region,
      blendIf: { ...blendIf, shadows: [0, 0] } })
    const reuseToken = gate.captureTile('tile', reused.id)
    const reusedResult = await reused
    assert.ok(reuseToken?.isCurrent(reusedResult))
    assert.equal(reusedResult.sourceId, staged.sourceId)
    assert.equal(reusedResult.timings.copyInMs, 0)
    assert.equal(new Uint8Array(reusedResult.rgba)[3], 101)

    const oldRequest = send({ type: 'blend-if-this-layer-staged-region', sourceId: staged.sourceId, region, blendIf })
    const oldToken = gate.captureTile('tile', oldRequest.id)
    const next = observer.observe(snapshot('#c8141e'))
    assert.ok(next.kind === 'source')
    assert.equal(gate.captureTile('tile', oldRequest.id + 1), null)
    assert.equal(oldToken?.isCurrent(await oldRequest), false)
    assert.equal((await send({ type: 'invalidate-source', generation: next.generation })).type, 'source-invalidated')
    const stale = await send({ type: 'blend-if-this-layer-staged-region', sourceId: staged.sourceId, region, blendIf })
    assert.deepEqual(stale, { type: 'error', id: stale.id, code: 'invalid-input' })
    const late = await send({ type: 'stage-source', rgba: prepare('#4b141e').buffer,
      sourceWidth: 3, sourceHeight: 1, generation: first.generation })
    assert.deepEqual(late, { type: 'error', id: late.id, code: 'invalid-input' })
    const replacementPixels = prepare('#c8141e')
    const replacement = await send({ type: 'stage-source', rgba: replacementPixels.buffer,
      sourceWidth: 3, sourceHeight: 1, generation: next.generation }, [replacementPixels.buffer])
    assert.ok(replacement.type === 'source-staged' && gate.adoptSource(replacement))
    const duplicate = await send({ type: 'stage-source', rgba: prepare('#4b141e').buffer,
      sourceWidth: 3, sourceHeight: 1, generation: next.generation })
    assert.deepEqual(duplicate, { type: 'error', id: duplicate.id, code: 'invalid-input' })
    const currentRequest = send({ type: 'blend-if-this-layer-staged-region', sourceId: replacement.sourceId, region, blendIf })
    const currentToken = gate.captureTile('tile', currentRequest.id)
    const current = await currentRequest
    assert.ok(currentToken?.isCurrent(current))
    assert.deepEqual(new Uint8Array(current.rgba), new Uint8Array(composeLayerStyleRaster(source,
      styles('#c8141e'), document.layerStyleGlobalLight).data))
    assert.equal(new Uint8Array(current.rgba)[3], 101)

    const intermediate = observer.observe(snapshot('#c8141e', undefined, 'source-2'))
    assert.ok(intermediate.kind === 'source')
    await send({ type: 'invalidate-source', generation: intermediate.generation })
    const newest = observer.observe(snapshot('#c8141e', undefined, 'source-3'))
    assert.ok(newest.kind === 'source')
    await send({ type: 'invalidate-source', generation: newest.generation })
    const outdatedUpload = await send({ type: 'stage-source', rgba: prepare('#c8141e').buffer,
      sourceWidth: 3, sourceHeight: 1, generation: intermediate.generation })
    assert.deepEqual(outdatedUpload, { type: 'error', id: outdatedUpload.id, code: 'invalid-input' })
    const newestUpload = await send({ type: 'stage-source', rgba: prepare('#c8141e').buffer,
      sourceWidth: 3, sourceHeight: 1, generation: newest.generation })
    assert.ok(newestUpload.type === 'source-staged' && gate.adoptSource(newestUpload))
    assert.equal(gate.adoptSource(replacement), false)
    assert.equal((await send({ type: 'dispose' })).type, 'disposed')
  } finally { await harness.close() }
})
