import wasmUrl from '../generated/axia_pixel_core.wasm?url'
import type { RustPixelPocRequest, RustPixelPocResponse } from './rustPixelPocProtocol.ts'
import { RustPixelPocPreviewObserver } from './rustPixelPocPreviewObserver.ts'
import { RustPixelPocTileGate } from './rustPixelPocTileGate.ts'
import { styledRasterPreviewSnapshot } from './rustPixelPocStyledSource.ts'
import { normalizeLayerStyleConfig } from './layerStyles.ts'
import { RustPixelPocStyleSession } from './rustPixelPocStyleSession.ts'
import { DEFAULT_TEXT_LAYER } from './text.ts'

type WithoutId<T> = T extends { id: number } ? Omit<T, 'id'> : never

/** Explicit diagnostic only; never an editor renderer. */
export async function runRustPixelPocDiagnostic(): Promise<{ elapsedMs: number; wasmBytes: number }> {
  const started = performance.now()
  const response = await fetch(wasmUrl)
  if (!response.ok) throw new Error(`WASM indisponível (HTTP ${response.status}).`)
  const wasm = await response.arrayBuffer()
  if (!wasm.byteLength) throw new Error('WASM vazio no pacote.')
  const wasmBytes = wasm.byteLength // The buffer is detached after transfer to the Worker.

  const worker = new Worker(new URL('../workers/rustPixelPoc.worker.ts', import.meta.url), { type: 'module' })
  let nextId = 0
  function send(request: WithoutId<RustPixelPocRequest>, transfers: Transferable[] = []):
    Promise<RustPixelPocResponse> & { id: number } {
    const id = ++nextId
    const pending = new Promise<RustPixelPocResponse>((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        cleanup()
        reject(new Error(`Tempo esgotado no Worker Rust (pedido ${id}).`))
      }, 10_000)
      function cleanup() {
        window.clearTimeout(timeout)
        worker.removeEventListener('message', onMessage)
        worker.removeEventListener('error', onError)
      }
      function onMessage(event: MessageEvent<RustPixelPocResponse>) {
        if (event.data.id !== id) return
        cleanup()
        if (event.data.type === 'error') reject(new Error(`Worker Rust: ${event.data.code}`))
        else resolve(event.data)
      }
      function onError(event: ErrorEvent) {
        cleanup()
        reject(new Error(`Worker Rust indisponível: ${event.message}`))
      }
      worker.addEventListener('message', onMessage)
      worker.addEventListener('error', onError)
      worker.postMessage({ ...request, id }, transfers)
    })
    return Object.assign(pending, { id })
  }

  try {
    const initialized = await send({ type: 'init', wasm }, [wasm])
    if (initialized.type !== 'ready') throw new Error('Worker Rust não inicializou.')
    const gate = new RustPixelPocTileGate()
    const observer = new RustPixelPocPreviewObserver(gate)
    const source = new Uint8Array([10, 20, 30, 101, 90, 80, 70, 255])
    const rendered = await send({ type: 'render', rgba: source.buffer as ArrayBuffer, fillOpacity: 50 }, [source.buffer])
    if (rendered.type !== 'rendered' ||
        [...new Uint8Array(rendered.rgba)].join(',') !== '10,20,30,51,90,80,70,128') {
      throw new Error('Worker Rust produziu RGBA diferente do golden.')
    }
    const regionSource = new Uint8Array([1, 2, 3, 255, 40, 50, 60, 255,
      4, 5, 6, 255, 7, 8, 9, 0])
    const tile = await send({ type: 'render-region', rgba: regionSource.buffer as ArrayBuffer,
      sourceWidth: 2, sourceHeight: 2, region: { x: 1, y: 0, width: 1, height: 2 },
      fillOpacity: 50 }, [regionSource.buffer])
    if (tile.type !== 'rendered-region' || tile.width !== 1 || tile.height !== 2 ||
        [...new Uint8Array(tile.rgba)].join(',') !== '40,50,60,128,0,0,0,0') {
      throw new Error('Worker Rust produziu tile diferente do golden.')
    }
    const stagedSource = new Uint8Array([1, 2, 3, 255, 40, 50, 60, 255,
      4, 5, 6, 255, 7, 8, 9, 0])
    const snapshot = { documentId: 'diagnostic', layerId: 'sample', sourceKey: 'sample-v1',
      appearanceKey: 'fill-50', viewportKey: 'scale-1' }
    const initial = observer.observe(snapshot)
    if (initial.kind !== 'source') throw new Error('Observador Rust não detectou a primeira fonte.')
    const staged = await send({ type: 'stage-source', rgba: stagedSource.buffer as ArrayBuffer,
      sourceWidth: 2, sourceHeight: 2, generation: initial.generation }, [stagedSource.buffer])
    if (staged.type !== 'source-staged' || !gate.adoptSource(staged)) {
      throw new Error('Worker Rust não carregou a fonte reutilizável atual.')
    }
    const target = new Uint8Array(8)
    const colorRequest = send({ type: 'color-overlay-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, target: target.buffer,
      effect: { color: [200, 120, 40, 255], opacity: 50, blendMode: 'normal' } }, [target.buffer])
    const colorToken = gate.captureTile('sobreposição-direita', colorRequest.id)
    const colored = await colorRequest
    if (!colorToken?.isCurrent(colored) || target.byteLength !== 0 ||
        [...new Uint8Array(colored.rgba)].join(',') !== '200,120,40,128,0,0,0,0') {
      throw new Error('Worker Rust produziu Sobreposição de cor diferente do golden.')
    }
    const patternTarget = new Uint8Array(8)
    const pattern = new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255])
    const patternRequest = send({ type: 'pattern-overlay-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, target: patternTarget.buffer,
      pattern: { rgba: pattern.buffer, width: 2, height: 1 },
      effect: { angle: 0, scale: 100, opacity: 100, blendMode: 'normal' } }, [patternTarget.buffer, pattern.buffer])
    const patternToken = gate.captureTile('padrão-direita', patternRequest.id)
    const patterned = await patternRequest
    if (!patternToken?.isCurrent(patterned) || patternTarget.byteLength !== 0 || pattern.byteLength !== 0 ||
        [...new Uint8Array(patterned.rgba)].join(',') !== '0,0,255,255,0,0,0,0') {
      throw new Error('Worker Rust produziu Sobreposição de padrão diferente do golden.')
    }
    for (const [type, gray] of [['linear', 191], ['reflected', 128], ['diamond', 255],
      ['radial', 180], ['angle', 223]] as const) {
      const gradientTarget = new Uint8Array(8)
      const gradientRequest = send({ type: 'gradient-overlay-staged-region', sourceId: staged.sourceId,
        region: { x: 1, y: 0, width: 1, height: 2 }, target: gradientTarget.buffer, effect: {
          gradient: { type, colorStops: [{ position: 0, color: [0, 0, 0, 255] }, { position: 1, color: [255, 255, 255, 255] }],
            opacityStops: [{ position: 0, opacity: 100 }, { position: 1, opacity: 100 }] },
          angle: 0, scale: 100, reverse: false, opacity: 100, blendMode: 'normal'
        } }, [gradientTarget.buffer])
      const gradientToken = gate.captureTile('gradiente-direita', gradientRequest.id)
      const gradientResult = await gradientRequest
      if (!gradientToken?.isCurrent(gradientResult) || gradientTarget.byteLength !== 0 ||
          [...new Uint8Array(gradientResult.rgba)].join(',') !== `${gray},${gray},${gray},255,0,0,0,0`) {
        throw new Error(`Worker Rust produziu gradiente ${type} diferente do golden.`)
      }
    }
    const shadowTarget = new Uint8Array(8)
    const shadowRequest = send({ type: 'drop-shadow-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, target: shadowTarget.buffer,
      shadow: { spreadRadius: 0, blurRadius: 1, offsetX: 0, offsetY: 0, color: [51, 102, 153, 255],
        opacity: 75, blendMode: 'multiply', noise: 0, seed: 0, knockout: true,
        contour: { preset: 'linear', points: [] } } }, [shadowTarget.buffer])
    const shadowToken = gate.captureTile('sombra-direita', shadowRequest.id), shadowResult = await shadowRequest
    if (!shadowToken?.isCurrent(shadowResult) || shadowTarget.byteLength !== 0 ||
        [...new Uint8Array(shadowResult.rgba)].join(',') !== '0,0,0,0,51,102,153,64') {
      throw new Error('Worker Rust produziu sombra externa diferente da referência fixa.')
    }
    const innerTarget = new Uint8Array(8)
    const innerRequest = send({ type: 'inner-shadow-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, target: innerTarget.buffer,
      shadow: { blurRadius: 1, offsetX: 0, offsetY: 0, color: [51, 102, 153, 255], choke: 37.5,
        opacity: 75, blendMode: 'multiply', noise: 0, seed: 0, contour: { preset: 'linear', points: [] } } }, [innerTarget.buffer])
    const innerToken = gate.captureTile('sombra-interna-direita', innerRequest.id), innerResult = await innerRequest
    if (!innerToken?.isCurrent(innerResult) || innerTarget.byteLength !== 0 ||
        [...new Uint8Array(innerResult.rgba)].join(',') !== '51,102,153,191,0,0,0,0') {
      throw new Error('Worker Rust produziu sombra interna diferente da referência fixa.')
    }
    for (const [kind, expected] of [['outer', '0,0,0,0,51,102,153,64'],
      ['inner-edge', '51,102,153,191,0,0,0,0'], ['inner-center', '51,102,153,64,0,0,0,0']] as const) {
      const glowTarget = new Uint8Array(8)
      const glowRequest = send({ type: 'glow-staged-region', sourceId: staged.sourceId,
        region: { x: 1, y: 0, width: 1, height: 2 }, target: glowTarget.buffer, glow: {
          kind, spreadRadius: 0, blurRadius: 1, precise: true, choke: 0, range: 100, jitter: 0, noise: 0,
          opacity: 75, blendMode: 'screen', seed: 0, contour: { preset: 'linear', points: [] },
          paint: { type: 'color', color: [51, 102, 153, 255] }
        } }, [glowTarget.buffer])
      const glowToken = gate.captureTile(`brilho-${kind}`, glowRequest.id), glowResult = await glowRequest
      if (!glowToken?.isCurrent(glowResult) || glowTarget.byteLength !== 0 ||
          [...new Uint8Array(glowResult.rgba)].join(',') !== expected) {
        throw new Error(`Worker Rust produziu brilho ${kind} diferente da referência fixa.`)
      }
    }
    for (const invert of [false, true]) {
      const satinTarget = new Uint8Array(8)
      const satinRequest = send({ type: 'satin-staged-region', sourceId: staged.sourceId,
        region: { x: 1, y: 0, width: 1, height: 2 }, target: satinTarget.buffer, satin: {
          radius: 0, offsetX: 1, offsetY: 0, invert, color: [51, 102, 153, 255],
          opacity: 75, blendMode: 'normal', contour: { preset: 'linear', points: [] }
        } }, [satinTarget.buffer])
      const satinToken = gate.captureTile(`acetinado-${invert}`, satinRequest.id), satinResult = await satinRequest
      const expected = invert ? '0,0,0,0,0,0,0,0' : '51,102,153,191,0,0,0,0'
      if (!satinToken?.isCurrent(satinResult) || satinTarget.byteLength !== 0 ||
          [...new Uint8Array(satinResult.rgba)].join(',') !== expected) {
        throw new Error('Worker Rust produziu acetinado diferente da referência fixa.')
      }
    }
    for (const [paint, expected] of [
      [{ type: 'color', color: [51, 102, 153, 255] }, '0,0,0,0,51,102,153,191'],
      [{ type: 'gradient', angle: 0, scale: 100, reverse: false, gradient: { type: 'linear',
        colorStops: [{ position: 0, color: [0, 0, 0, 255] }, { position: 1, color: [255, 255, 255, 255] }],
        opacityStops: [{ position: 0, opacity: 100 }, { position: 1, opacity: 100 }] } }, '0,0,0,0,191,191,191,191'],
      [{ type: 'pattern', angle: 0, scale: 100, pattern: { width: 2, height: 1,
        rgba: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) } }, '0,0,0,0,0,0,255,191']
    ] satisfies [import('./rustPixelPocStroke.ts').RustPixelPocStroke['paint'], string][]) {
      const strokeTarget = new Uint8Array(8)
      const strokeRequest = send({ type: 'stroke-staged-region', sourceId: staged.sourceId,
        region: { x: 1, y: 0, width: 1, height: 2 }, target: strokeTarget.buffer, stroke: {
          outsideRadius: 1, insideRadius: 0, opacity: 75, blendMode: 'normal', paint
        } }, [strokeTarget.buffer])
      const strokeToken = gate.captureTile(`traçado-${paint.type}`, strokeRequest.id), strokeResult = await strokeRequest
      if (!strokeToken?.isCurrent(strokeResult) || strokeTarget.byteLength !== 0 ||
          [...new Uint8Array(strokeResult.rgba)].join(',') !== expected) {
        throw new Error(`Worker Rust produziu traçado ${paint.type} diferente da referência fixa.`)
      }
    }
    for (const style of ['inner-bevel', 'outer-bevel'] as const) {
      const bevelTarget = new Uint8Array(8)
      const bevelRequest = send({ type: 'bevel-staged-region', sourceId: staged.sourceId,
        region: { x: 1, y: 0, width: 1, height: 2 }, target: bevelTarget.buffer, bevel: {
          radius: 1, softenRadius: 0, technique: 'smooth', style, direction: 'up', opacity: 100,
          strength: 4, light: [0, 0, 1], highlightMode: 'normal', shadowMode: 'normal',
          highlightColor: [51, 102, 153, 255], shadowColor: [0, 0, 0, 255], highlightOpacity: 75, shadowOpacity: 75,
          glossContour: { preset: 'linear', points: [] }, contourEnabled: false,
          contour: { preset: 'linear', points: [] }, contourRange: 100,
          textureScaleFactor: 1, textureDepthFactor: 0, textureInvert: false
        } }, [bevelTarget.buffer])
      const bevelToken = gate.captureTile(`bisel-${style}`, bevelRequest.id), bevelResult = await bevelRequest
      const expected = style === 'inner-bevel' ? '51,102,153,191,0,0,0,0' : '0,0,0,0,51,102,153,191'
      if (!bevelToken?.isCurrent(bevelResult) || bevelTarget.byteLength !== 0 ||
          [...new Uint8Array(bevelResult.rgba)].join(',') !== expected) {
        throw new Error(`Worker Rust produziu bisel ${style} diferente da referência fixa.`)
      }
    }
    const stagesRequest = send({ type: 'style-stages-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, plan: { fillOpacity: 0,
        external: [{ type: 'drop-shadow', shadow: { spreadRadius: 0, blurRadius: 0, offsetX: 0, offsetY: 0,
          color: [255, 0, 0, 255], opacity: 100, blendMode: 'normal', noise: 0, seed: 0, knockout: false,
          contour: { preset: 'linear', points: [] } } }], internal: [],
        overlay: [{ type: 'color-overlay', effect: { color: [0, 0, 255, 255], opacity: 50, blendMode: 'normal' } }],
        upper: [{ type: 'stroke', stroke: { outsideRadius: 1, insideRadius: 0, opacity: 75, blendMode: 'normal',
          paint: { type: 'color', color: [51, 102, 153, 255] } } }]
      } })
    const stagesToken = gate.captureTile('estágios-direita', stagesRequest.id), stagesResult = await stagesRequest
    if (!stagesToken?.isCurrent(stagesResult) ||
        [...new Uint8Array(stagesResult.rgba)].join(',') !== '127,0,128,255,51,102,153,191') {
      throw new Error('Worker Rust não preservou sombra → conteúdo → overlay → traçado.')
    }
    const maskRequest = send({ type: 'alpha-mask-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, config: { spreadRadius: 0, blurRadius: 1, precise: false } })
    const maskToken = gate.captureTile('máscara-direita', maskRequest.id)
    const maskResult = await maskRequest
    if (!maskToken?.isCurrent(maskResult) || maskResult.timings.copyInMs !== 0 ||
        [...new Uint8Array(maskResult.rgba)].join(',') !== '0,0,0,85,0,0,0,85') {
      throw new Error('Worker Rust produziu máscara com halo diferente da referência fixa.')
    }
    const batchRequest = send({ type: 'local-batch-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, plan: { fillOpacity: 0, effects: [
        { type: 'color-overlay', effect: { color: [255, 0, 0, 255], opacity: 50, blendMode: 'normal' } },
        { type: 'color-overlay', effect: { color: [0, 0, 255, 255], opacity: 50, blendMode: 'normal' } }
      ], thisLayerBlendIf: { channel: 'red', shadows: [0, 170], highlights: [255, 255] } } })
    const batchToken = gate.captureTile('lote-direita', batchRequest.id)
    const batchResult = await batchRequest
    if (!batchToken?.isCurrent(batchResult) ||
        [...new Uint8Array(batchResult.rgba)].join(',') !== '85,0,170,96,0,0,0,0') {
      throw new Error('Worker Rust produziu lote de estilos diferente do golden.')
    }
    const backdrop = new Uint8Array([75, 0, 0, 255, 100, 0, 0, 0])
    const blendRequest = send({ type: 'blend-if-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, backdrop: backdrop.buffer,
      blendIf: { channel: 'red', shadows: [50, 100], highlights: [255, 255] } }, [backdrop.buffer])
    const blendToken = gate.captureTile('blend-if-direita', blendRequest.id)
    const blended = await blendRequest
    if (!blendToken?.isCurrent(blended) || backdrop.byteLength !== 0 ||
        [...new Uint8Array(blended.rgba)].join(',') !== '40,50,60,128,7,8,9,0') {
      throw new Error('Worker Rust produziu Mesclar se diferente do golden.')
    }
    const thisLayerRequest = send({ type: 'blend-if-this-layer-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 },
      blendIf: { channel: 'red', shadows: [20, 60], highlights: [255, 255] } })
    const thisLayerToken = gate.captureTile('esta-camada-direita', thisLayerRequest.id)
    const filtered = await thisLayerRequest
    if (!thisLayerToken?.isCurrent(filtered) || filtered.timings.copyInMs !== 0 ||
        [...new Uint8Array(filtered.rgba)].join(',') !== '40,50,60,128,7,8,9,0') {
      throw new Error('Worker Rust produziu Mesclar se — Esta camada diferente do golden.')
    }
    const pendingTile = send({ type: 'render-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, fillOpacity: 50 })
    const tileToken = gate.captureTile('coluna-direita', pendingTile.id)
    if (!tileToken) throw new Error('Fonte Rust ausente para o tile.')
    const cachedTile = await pendingTile
    if (!tileToken.isCurrent(cachedTile) ||
        cachedTile.timings.copyInMs !== 0 ||
        [...new Uint8Array(cachedTile.rgba)].join(',') !== '40,50,60,128,0,0,0,0') {
      throw new Error('Worker Rust não reutilizou a fonte entre tiles.')
    }
    if (observer.observe({ ...snapshot, viewportKey: 'scale-2' }).kind !== 'view' ||
        tileToken.isCurrent(cachedTile)) {
      throw new Error('Observador Rust não invalidou o tile após mudar a vista.')
    }
    const olderRequest = send({ type: 'render-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, fillOpacity: 25 })
    const olderToken = gate.captureTile('pedido-repetido', olderRequest.id)
    const newerRequest = send({ type: 'render-staged-region', sourceId: staged.sourceId,
      region: { x: 1, y: 0, width: 1, height: 2 }, fillOpacity: 50 })
    const newerToken = gate.captureTile('pedido-repetido', newerRequest.id)
    const [olderResult, newerResult] = await Promise.all([olderRequest, newerRequest])
    if (!olderToken || !newerToken || olderToken.isCurrent(olderResult) ||
        !newerToken.isCurrent(newerResult)) {
      throw new Error('Gate Rust aceitou um pedido ultrapassado do mesmo tile.')
    }
    const next = observer.observe({ ...snapshot, sourceKey: 'sample-v2', viewportKey: 'scale-2' })
    if (next.kind !== 'source' || newerToken.isCurrent(newerResult)) {
      throw new Error('Observador Rust não invalidou a fonte anterior.')
    }
    const released = await send({ type: 'release-source', sourceId: staged.sourceId })
    if (released.type !== 'source-released') throw new Error('Worker Rust não liberou a fonte.')
    const invalidated = await send({ type: 'invalidate-source', generation: next.generation })
    if (invalidated.type !== 'source-invalidated' || invalidated.generation !== next.generation) {
      throw new Error('Worker Rust não avançou a geração da fonte.')
    }
    const styledDocument = { id: 'diagnostic', width: 2, height: 1, background: 'transparent' as const,
      colorSpace: 'srgb' as const, resolutionDpi: 72, layerStyleGlobalLight: { angle: 30, altitude: 30 } }
    const styledLayer = { id: 'sample', kind: 'pixel' as const, visible: true, opacity: 100,
      blendMode: 'normal' as const, styles: normalizeLayerStyleConfig({ fillOpacity: 0,
        effects: [{ type: 'color-overlay', id: 'color', color: '#c87828' }],
        blendIf: { channel: 'red', thisLayer: { shadows: [150, 250], highlights: [255, 255] } } }) }
    const styledViewport = { scale: 1, devicePixelRatio: 1, scrollLeft: 0, scrollTop: 0,
      width: 800, height: 600, stackKey: 'diagnostic' }
    const styledIdentity = { contentKey: 'styled-sample', assetKey: '', width: 2, height: 1,
      offsetX: 0, offsetY: 0, resolutionScale: 1, quality: 'final' as const }
    const styledSnapshot = styledRasterPreviewSnapshot(styledDocument, styledLayer, undefined,
      styledViewport, styledIdentity)
    const styledChange = observer.observe(styledSnapshot)
    if (styledChange.kind !== 'source') throw new Error('Observador Rust não distinguiu a fonte estilizada.')
    await send({ type: 'invalidate-source', generation: styledChange.generation })
    const styledPixels = new Uint8Array([200, 120, 40, 255, 200, 120, 40, 101])
    const styledSource = await send({ type: 'stage-source', rgba: styledPixels.buffer,
      sourceWidth: 2, sourceHeight: 1, generation: styledChange.generation }, [styledPixels.buffer])
    if (styledSource.type !== 'source-staged' || !gate.adoptSource(styledSource)) {
      throw new Error('Worker Rust rejeitou upload após invalidar a mesma geração.')
    }
    const styledRequest = send({ type: 'blend-if-this-layer-staged-region', sourceId: styledSource.sourceId,
      region: { x: 0, y: 0, width: 2, height: 1 }, blendIf: {
        channel: 'red', shadows: [150, 250], highlights: [255, 255] } })
    const styledToken = gate.captureTile('fonte-estilizada', styledRequest.id)
    const styledResult = await styledRequest
    if (!styledToken?.isCurrent(styledResult) || styledResult.timings.copyInMs !== 0 ||
        [...new Uint8Array(styledResult.rgba)].join(',') !== '200,120,40,128,200,120,40,51') {
      throw new Error('Worker Rust não filtrou a nova fonte estilizada corretamente.')
    }
    const changedThresholds = styledRasterPreviewSnapshot(styledDocument, {
      ...styledLayer, styles: normalizeLayerStyleConfig({ ...styledLayer.styles, blendIf: { channel: 'red' } })
    }, undefined, styledViewport, styledIdentity)
    if (observer.observe(changedThresholds).kind !== 'view' || styledToken.isCurrent(styledResult) ||
        !gate.captureTile('fonte-estilizada', nextId + 1)) {
      throw new Error('Observador Rust não reutilizou pixels ao mudar somente as faixas.')
    }
    const boundaryPixels = new Uint8Array(7 * 11 * 4)
    boundaryPixels.set([40, 60, 80, 101], (1 * 7 + 1) * 4)
    const boundarySource = await send({ type: 'stage-source', rgba: boundaryPixels.buffer,
      sourceWidth: 7, sourceHeight: 11, generation: gate.beginSourceChange() }, [boundaryPixels.buffer])
    if (boundarySource.type !== 'source-staged' || !gate.adoptSource(boundarySource)) {
      throw new Error('Worker Rust não preparou a fonte dos limites de gradiente.')
    }
    for (const type of ['radial', 'angle'] as const) {
      const angle = type === 'radial' ? 0 : -77.75
      const raw = type === 'radial' ? Math.hypot(-2 / 3.5, -4 / 5.5)
        : ((Math.atan2(-4, -2) - angle * Math.PI / 180) / (Math.PI * 2) + 1) % 1
      const position = Math.max(0, Math.min(1, 0.5 + (raw - 0.5) * 100 / 100))
      const request = send({ type: 'gradient-overlay-staged-region', sourceId: boundarySource.sourceId,
        region: { x: 1, y: 1, width: 1, height: 1 }, target: new ArrayBuffer(4), effect: {
          gradient: { type, colorStops: [{ position: 0, color: [0, 0, 0, 255] },
            { position, color: [0, 0, 0, 255] }, { position, color: [255, 255, 255, 255] },
            { position: 1, color: [255, 255, 255, 255] }],
          opacityStops: [{ position: 0, opacity: 100 }, { position: 1, opacity: 100 }] },
          angle, scale: 100, reverse: false, opacity: 100, blendMode: 'normal'
        } })
      const token = gate.captureTile('gradiente-limite', request.id)
      const result = await request
      if (!token?.isCurrent(result) || [...new Uint8Array(result.rgba)].join(',') !== '0,0,0,101') {
        throw new Error(`Worker Rust divergiu do arredondamento JS no gradiente ${type}.`)
      }
    }
    const session = new RustPixelPocStyleSession(send, gate)
    let sourceLoads = 0
    const preparedStyles = normalizeLayerStyleConfig({ fillOpacity: 0, effects: [
      { type: 'drop-shadow', id: 'prepared-shadow', color: '#ff0000', size: 0, distance: 1, angle: 0,
        useGlobalLight: false, opacity: 100, layerKnocksOutShadow: false },
      { type: 'color-overlay', id: 'prepared-color', color: '#0000ff', opacity: 50 }
    ] })
    const preparedRequest = { sourceIdentity: 'raw-diagnostic-v1', sourceWidth: 1, sourceHeight: 1,
      styles: preparedStyles, globalLight: { angle: 30, altitude: 30 }, source: async () => {
        sourceLoads++
        return { width: 1, height: 1, data: new Uint8ClampedArray([40, 60, 80, 255]) }
      } }
    const prepared = await session.compose(preparedRequest)
    if (prepared.width !== 2 || prepared.height !== 1 || prepared.offsetX !== -1 || prepared.offsetY !== 0 ||
        [...new Uint8Array(prepared.rgba)].join(',') !== '255,0,0,255,0,0,255,128') {
      throw new Error('Sessão Rust divergiu na preparação da fonte e da sombra externa.')
    }
    const reused = await session.compose({ ...preparedRequest, styles: normalizeLayerStyleConfig({ ...preparedStyles, fillOpacity: 100 }),
      region: { x: 1, y: 0, width: 1, height: 1 } })
    if (reused.sourceId !== prepared.sourceId || sourceLoads !== 1 || reused.offsetX !== 0 ||
        [...new Uint8Array(reused.rgba)].join(',') !== '20,30,168,255') {
      throw new Error('Sessão Rust não reutilizou a fonte original entre estilos e tiles.')
    }
    await session.dispose()
    const mediaSession = new RustPixelPocStyleSession(send, gate)
    async function pngFixture(rgba: number[]) {
      const canvas = new OffscreenCanvas(1, 1)
      try {
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas indisponível no diagnóstico de mídia.')
        context.putImageData(new ImageData(new Uint8ClampedArray(rgba), 1, 1), 0, 0)
        return await canvas.convertToBlob({ type: 'image/png' })
      } finally { canvas.width = 1; canvas.height = 1 }
    }
    const mediaBlob = await pngFixture([40, 60, 80, 255])
    let mediaLoads = 0
    const mediaRequest = { ...preparedRequest, sourceIdentity: 'png-diagnostic-v1', source: async () => {
      mediaLoads++; return { type: 'raster' as const, blob: mediaBlob }
    } }
    const media = await mediaSession.composeMedia(mediaRequest)
    if (media.width !== prepared.width || media.offsetX !== prepared.offsetX ||
        [...new Uint8Array(media.rgba)].join(',') !== '255,0,0,255,0,0,255,128') {
      throw new Error('Decode PNG no Worker Rust divergiu da fixture RGBA.')
    }
    const mediaTile = await mediaSession.composeMedia({ ...mediaRequest,
      styles: normalizeLayerStyleConfig({ ...preparedStyles, fillOpacity: 100 }), region: { x: 1, y: 0, width: 1, height: 1 } })
    if (mediaTile.sourceId !== media.sourceId || mediaLoads !== 1 ||
        [...new Uint8Array(mediaTile.rgba)].join(',') !== '20,30,168,255') {
      throw new Error('Worker Rust não reutilizou fonte PNG entre estilos/tiles.')
    }
    const assetBlob = await pngFixture([255, 0, 0, 255])
    const mediaPattern = { id: 'diagnostic-pattern', name: 'diagnostic', width: 1, height: 1,
      mimeType: 'image/png', sourceUrl: 'data:image/png;base64,AA==' }
    const assetRequest = { ...mediaRequest, styles: normalizeLayerStyleConfig({ fillOpacity: 0,
      effects: [{ type: 'pattern-overlay', pattern: mediaPattern, opacity: 100 }] }) }
    const red = await mediaSession.composeMedia({ ...assetRequest, patterns: { [mediaPattern.id]: assetBlob } })
    const green = await mediaSession.composeMedia({ ...assetRequest, patterns: { [mediaPattern.id]: await pngFixture([0, 255, 0, 255]) } })
    if (red.sourceId !== green.sourceId || [...new Uint8Array(red.rgba)].join(',') !== '255,0,0,255' ||
        [...new Uint8Array(green.rgba)].join(',') !== '0,255,0,255') {
      throw new Error('Worker Rust não atualizou pixels do padrão sem cache de resultado.')
    }
    const text = await mediaSession.composeMedia({ sourceIdentity: 'text-diagnostic-v1', sourceWidth: 120, sourceHeight: 58,
      styles: normalizeLayerStyleConfig({}), globalLight: { angle: 30, altitude: 30 }, source: async () => ({
        type: 'text' as const, text: { ...DEFAULT_TEXT_LAYER, content: 'Axia' }, drawScaleX: 1, drawScaleY: 1
      }) })
    if (!new Uint8Array(text.rgba).some((value, index) => index % 4 === 3 && value > 0)) {
      throw new Error('Worker Rust recebeu fonte de texto vazia.')
    }
    await mediaSession.dispose()
    const disposed = await send({ type: 'dispose' })
    if (disposed.type !== 'disposed') throw new Error('Worker Rust não descartou o estado.')
    return { elapsedMs: performance.now() - started, wasmBytes }
  } finally {
    worker.terminate()
  }
}
