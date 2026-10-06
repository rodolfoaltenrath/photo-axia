import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { cpus, release, tmpdir, totalmem } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPreviewWailsProbe, summarizePreviewFrames } from '../benchmarks/previewWailsProbe.ts'

if (process.platform !== 'win32') throw new Error('Smoke do preview Wails/WebView2 disponível apenas no Windows.')

const benchmarkMode = process.argv.includes('--benchmark')
const rustMode = process.argv.includes('--rust-styles') || process.argv.includes('--rust-styles-fallback')
const rustFallback = process.argv.includes('--rust-styles-fallback')
const sizeArgument = process.argv.find((argument) => argument.startsWith('--size='))
const cyclesArgument = process.argv.find((argument) => argument.startsWith('--cycles='))
const imageSize = sizeArgument ? Number(sizeArgument.slice('--size='.length)) : 512
const cycles = cyclesArgument ? Number(cyclesArgument.slice('--cycles='.length)) : 2
if (!Number.isSafeInteger(imageSize) || imageSize < 64 || imageSize > 4096 ||
    !Number.isSafeInteger(cycles) || cycles < 1 || cycles > 10) {
  throw new Error('Use --size=64..4096 e --cycles=1..10.')
}

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const declaredGoVersion = /^go (\d+\.\d+\.\d+)\r?$/m.exec(readFileSync(join(repoRoot, 'go.mod'), 'utf8'))?.[1]
if (!declaredGoVersion) throw new Error('go.mod não declara uma versão Go exata.')
const goEnvironment = { ...process.env, GOTOOLCHAIN: `go${declaredGoVersion}` }
const staging = mkdtempSync(join(tmpdir(), 'axia-preview-wails-smoke-'))
const binary = join(staging, 'axia-preview-smoke.exe')
const webviewData = join(staging, 'webview-data')
mkdirSync(webviewData)
let app
let socket
let appError
let appOutput = ''

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function unusedLocalPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  await new Promise((resolve) => server.close(resolve))
  return port
}

async function targetAt(port) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (appError) throw appError
    if (app?.exitCode !== null && app?.exitCode !== undefined) {
      throw new Error(`Axia encerrou antes de abrir o WebView2: ${app.exitCode}. ${appOutput}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const pages = await response.json()
      const target = pages.find((page) => page.type === 'page' && page.url.includes('axiaPreviewSmoke=1'))
      if (target?.webSocketDebuggerUrl) return target
    } catch { /* WebView2 ainda está iniciando. */ }
    await delay(100)
  }
  throw new Error(`WebView2 não expôs a página do preview em 30 segundos. ${appOutput}`)
}

function evaluator(ws) {
  let nextId = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    clearTimeout(entry.timeout)
    if (message.error) entry.reject(new Error(message.error.message))
    else if (message.result?.exceptionDetails) {
      entry.reject(new Error(message.result.exceptionDetails.text))
    } else entry.resolve(message.result?.result?.value)
  })
  ws.addEventListener('close', () => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timeout)
      entry.reject(new Error('DevTools WebView2 desconectou.'))
    }
    pending.clear()
  })
  return (expression) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error('DevTools WebView2 não respondeu.'))
    }, benchmarkMode ? 30_000 + cycles * 30_000 : 10_000)
    pending.set(id, { resolve, reject, timeout })
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate',
      params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}

let nextScreenshotId = 1_000_000
function screenshot(ws, clip) {
  const id = ++nextScreenshotId
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('DevTools não devolveu o screenshot.')), 10_000)
    function finish(error, data) {
      clearTimeout(timeout)
      ws.removeEventListener('message', onMessage)
      if (error) reject(error)
      else resolve(data)
    }
    function onMessage(event) {
      const message = JSON.parse(event.data)
      if (message.id !== id) return
      if (message.error || !message.result?.data) {
        finish(new Error(message.error?.message ?? 'Screenshot sem dados.'))
      } else finish(null, message.result.data)
    }
    ws.addEventListener('message', onMessage)
    ws.send(JSON.stringify({ id, method: 'Page.captureScreenshot', params: {
      format: 'png', fromSurface: true, captureBeyondViewport: false, clip
    } }))
  })
}

async function waitFor(evaluate, expression, predicate, label, attempts = 300) {
  let observation
  for (let attempt = 0; attempt < attempts; attempt++) {
    observation = await evaluate(expression)
    if (predicate(observation)) return observation
    await delay(100)
  }
  throw new Error(`${label} não ficou pronto. Último estado: ${JSON.stringify(observation)}`)
}

try {
  const goVersionResult = spawnSync('go', ['version'], {
    cwd: repoRoot, windowsHide: true, encoding: 'utf8', env: goEnvironment
  })
  if (goVersionResult.error) throw goVersionResult.error
  if (goVersionResult.status !== 0) throw new Error('Não foi possível identificar a versão do Go.')
  const goVersion = goVersionResult.stdout.trim()
  const build = spawnSync('go', [
    'build', '-tags', 'production', '-trimpath', '-buildvcs=false', '-o', binary, '.'
  ], { cwd: repoRoot, windowsHide: true, stdio: 'inherit', env: goEnvironment })
  if (build.error) throw build.error
  if (build.status !== 0) throw new Error(`go build falhou: ${build.status}`)

  const port = await unusedLocalPort()
  app = spawn(binary, ['--axia-preview-smoke', ...(rustMode ? ['--axia-rust-styles-preview'] : [])], {
    cwd: repoRoot, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env,
      AXIA_PREVIEW_CDP_PORT: String(port), AXIA_PREVIEW_WEBVIEW_DATA: webviewData }
  })
  app.once('error', (error) => { appError = error })
  for (const stream of [app.stdout, app.stderr]) {
    stream.on('data', (chunk) => { appOutput = (appOutput + chunk.toString()).slice(-4000) })
  }
  const target = await targetAt(port)
  const browserVersion = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).Browser
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const evaluate = evaluator(socket)
  if (rustMode) {
    await waitFor(evaluate, 'new URLSearchParams(location.search).get("axiaRustStyles") === "1"', Boolean, 'Flag Rust no preview')
  }
  const environment = await evaluate('({ devicePixelRatio, hardwareConcurrency: navigator.hardwareConcurrency })')
  await waitFor(evaluate, 'Boolean(document.querySelector(".project-home"))', Boolean, 'Tela inicial')
  if (rustMode) {
    await evaluate(`(() => {
      const Original = window.Worker
      const stats = window.__axiaRustWorkers = { created: 0, alive: 0, peak: 0 }
      window.Worker = class extends Original {
        constructor(url, options) {
          super(url, options)
          this.tracked = String(url).includes('rustPixelPoc.worker')
          if (this.tracked) { stats.created++; stats.alive++; stats.peak = Math.max(stats.peak, stats.alive) }
        }
        terminate() {
          if (this.tracked) { this.tracked = false; stats.alive-- }
          return super.terminate()
        }
      }
      return true
    })()`)
  }
  if (rustFallback) {
    await evaluate(`(() => {
      const original = window.fetch.bind(window)
      window.fetch = (resource, options) => String(resource).endsWith('.wasm')
        ? Promise.resolve(new Response('', { status: 503 })) : original(resource, options)
      return true
    })()`)
  }

  const dropped = await evaluate(`(async () => {
    const canvas = document.createElement('canvas')
    canvas.width = ${imageSize}
    canvas.height = ${imageSize}
    const context = canvas.getContext('2d')
    context.fillStyle = '#2468a0'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#f4d36a'
    context.fillRect(canvas.width / 8, canvas.height / 8, canvas.width * 3 / 4, canvas.height * 3 / 4)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
    if (!blob) throw new Error('PNG sintético não foi criado.')
    const transfer = new DataTransfer()
    transfer.items.add(new File([blob], 'axia-preview-smoke.png', { type: 'image/png' }))
    const home = document.querySelector('.project-home')
    if (!home) throw new Error('Tela inicial ausente.')
    home.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
    return { bytes: blob.size }
  })()`)
  assert.ok(dropped?.bytes > 0, 'A imagem sintética não foi entregue à tela inicial.')

  const layerId = await waitFor(evaluate, `(() => {
    const image = document.querySelector('.document-layer img.layer-image-buffer--active')
    return image?.complete && image.naturalWidth > 0
      ? image.closest('.document-layer')?.dataset.layerId : null
  })()`, Boolean, 'Imagem ativa no editor')
  await waitFor(evaluate,
    'Boolean(document.querySelector(".side-panels:not([inert])"))', Boolean,
    'Painéis habilitados após abrir a imagem')
  const selected = await evaluate(`(() => {
    const button = document.querySelector('.layer-row[data-layer-id=${JSON.stringify(layerId)}] .layer-button')
    if (!button) return false
    button.click()
    return true
  })()`)
  assert.equal(selected, true, 'A camada da imagem não foi encontrada no painel.')
  await waitFor(evaluate,
    `Boolean(document.querySelector('.layer-row[data-layer-id=${JSON.stringify(layerId)}].layer-row--active'))`,
    Boolean, 'Camada da imagem selecionada')

  const openedStyles = await evaluate(`(() => {
    const tab = [...document.querySelectorAll('.inspector-tabs [role="tab"]')]
      .find((item) => item.textContent.trim() === 'Estilos')
    if (!tab) return false
    tab.click()
    return true
  })()`)
  assert.equal(openedStyles, true, 'A aba de estilos não foi encontrada.')
  await waitFor(evaluate,
    'Boolean(document.querySelector(".style-thumbnail-apply:not(:disabled)"))', Boolean,
    'Preset habilitado após a importação')

  const clip = await evaluate(`(() => {
    const layer = document.querySelector('.document-layer[data-layer-id=${JSON.stringify(layerId)}]')
    const viewport = document.querySelector('.canvas-scroll')
    if (!layer || !viewport) return null
    const rect = layer.getBoundingClientRect()
    const visible = viewport.getBoundingClientRect()
    const x = Math.max(0, Math.floor(Math.max(visible.left, rect.left - 32)))
    const y = Math.max(0, Math.floor(Math.max(visible.top, rect.top - 32)))
    const right = Math.min(innerWidth, Math.ceil(Math.min(visible.right, rect.right + 32)))
    const bottom = Math.min(innerHeight, Math.ceil(Math.min(visible.bottom, rect.bottom + 32)))
    return { x, y, width: right - x, height: bottom - y, scale: 1 }
  })()`)
  assert.ok(clip?.width > 16 && clip?.height > 16, 'Camada fora do viewport de captura.')
  await evaluate('(async () => { await new Promise(requestAnimationFrame); return true })()')
  const beforeScreenshot = await screenshot(socket, clip)

  const armed = await evaluate(`(() => {
    const root = document.querySelector('.document-layer[data-layer-id=${JSON.stringify(layerId)}]')
    const initial = root?.querySelector('img.layer-image-buffer--active')?.getAttribute('src')
    if (!root || !initial) return false
    const probe = { started: performance.now(), initial, lostActive: false, result: null }
    const active = () => root.querySelector('img.layer-image-buffer--active')
    const inspect = () => {
      const current = active()
      if (!current) probe.lostActive = true
      for (const image of root.querySelectorAll('img.layer-image-buffer')) {
        const source = image.getAttribute('src')
        if (source && source !== initial && probe.sourcePublishedMs === undefined) {
          probe.sourcePublishedMs = performance.now() - probe.started
        }
      }
      if (current && current.getAttribute('src') !== initial && current.complete && current.naturalWidth > 0) {
        probe.activeMs = performance.now() - probe.started
        probe.result = { sourcePublishedMs: probe.sourcePublishedMs, loadMs: probe.loadMs,
          activeMs: probe.activeMs, lostActive: probe.lostActive,
          naturalWidth: current.naturalWidth }
        probe.observer.disconnect()
        root.removeEventListener('load', onLoad, true)
      }
    }
    const onLoad = (event) => {
      if (event.target?.getAttribute('src') !== initial && probe.loadMs === undefined) {
        probe.loadMs = performance.now() - probe.started
      }
      inspect()
    }
    root.addEventListener('load', onLoad, true)
    probe.observer = new MutationObserver(inspect)
    probe.observer.observe(root, { attributes: true, childList: true, subtree: true,
      attributeFilter: ['src', 'class'] })
    window.__axiaPreviewSmoke = probe
    return true
  })()`)
  assert.equal(armed, true, 'Não foi possível observar o buffer ativo.')
  const clicked = await evaluate(`(() => {
    const preset = [...document.querySelectorAll('.style-thumbnail-apply')]
      .find((button) => button.title.startsWith('Aplicar Sombra suave.'))
    if (!preset || preset.disabled) return false
    preset.click()
    return true
  })()`)
  assert.equal(clicked, true, 'O preset de sombra não foi encontrado.')

  const observed = await waitFor(evaluate, `(() => {
    const probe = window.__axiaPreviewSmoke
    const root = document.querySelector('.document-layer[data-layer-id=${JSON.stringify(layerId)}]')
    const active = root?.querySelector('img.layer-image-buffer--active')
    return {
      result: probe?.result ?? null,
      publishedMs: probe?.sourcePublishedMs ?? null,
      loadMs: probe?.loadMs ?? null,
      activeIsOriginal: active?.getAttribute('src') === probe?.initial,
      bufferCount: root?.querySelectorAll('img.layer-image-buffer[src]').length ?? 0,
      imageLayerActive: Boolean(document.querySelector('.layer-row[data-layer-id=${JSON.stringify(layerId)}].layer-row--active')),
      styleIndicatorCount: document.querySelectorAll('.layer-style-indicator').length,
      statusText: document.querySelector('.document-status span')?.textContent?.trim() ?? null,
      sidePanelsInert: document.querySelector('.side-panels')?.hasAttribute('inert') ?? null,
      error: document.querySelector('.error-banner')?.textContent?.trim() ?? null
    }
  })()`, (value) => Boolean(value?.result || value?.error), 'Handoff do estilo', 300)
  assert.equal(observed.error, null, `O editor recusou o estilo: ${observed.error}`)
  assert.equal(observed.result.lostActive, false, 'O buffer antigo desapareceu durante a troca.')
  assert.ok(observed.result.naturalWidth > 0, 'O novo buffer não está decodificado.')
  assert.ok(Number.isFinite(observed.result.sourcePublishedMs), 'Nova fonte não foi publicada.')
  assert.ok(observed.result.activeMs >= observed.result.sourcePublishedMs, 'Buffer ativado antes da publicação.')
  await evaluate('(async () => { await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); return true })()')
  const afterScreenshot = await screenshot(socket, clip)
  const visual = await evaluate(`(async () => {
    async function pixels(encoded) {
      const binary = atob(encoded)
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
      const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
      try {
        const canvas = document.createElement('canvas')
        canvas.width = bitmap.width
        canvas.height = bitmap.height
        const context = canvas.getContext('2d', { willReadFrequently: true })
        context.drawImage(bitmap, 0, 0)
        return { width: bitmap.width, height: bitmap.height,
          rgba: context.getImageData(0, 0, bitmap.width, bitmap.height).data }
      } finally { bitmap.close() }
    }
    const before = await pixels(${JSON.stringify(beforeScreenshot)})
    const after = await pixels(${JSON.stringify(afterScreenshot)})
    if (before.width !== after.width || before.height !== after.height) {
      throw new Error('Dimensões do screenshot mudaram durante o estilo.')
    }
    let changedPixels = 0
    for (let index = 0; index < before.rgba.length; index += 4) {
      if (Math.abs(before.rgba[index] - after.rgba[index]) > 2 ||
          Math.abs(before.rgba[index + 1] - after.rgba[index + 1]) > 2 ||
          Math.abs(before.rgba[index + 2] - after.rgba[index + 2]) > 2) changedPixels++
    }
    return { width: before.width, height: before.height, changedPixels }
  })()`)
  assert.ok(visual.changedPixels > 100, 'O estilo não mudou pixels visíveis no screenshot do canvas.')
  const rustStats = rustMode ? await evaluate('JSON.parse(document.documentElement.dataset.axiaRustStylePreview || "null")') : null
  if (rustMode) {
    assert.ok(rustStats, 'Preview não publicou diagnóstico do backend experimental.')
    assert.equal(rustStats.last.backend, rustFallback ? 'legacy' : 'rust')
    assert.equal(rustStats.fallbacks, rustFallback ? 1 : 0)
    assert.equal(rustStats.circuitOpen, rustFallback)
    if (!rustFallback) assert.ok(rustStats.service.leases >= 1 && rustStats.service.leases <= 2)
  }
  const frameSamples = benchmarkMode
    ? await evaluate(`(${runPreviewWailsProbe.toString()})(${JSON.stringify(layerId)}, ${cycles})`)
    : null
  const frameMetrics = frameSamples?.map(summarizePreviewFrames)
  let rustMultilayer = null
  if (rustMode && !benchmarkMode) {
    const duplicated = await evaluate(`(async () => {
      for (let index = 0; index < 2; index++) {
        const button = document.querySelector('button[title="Duplicar camada (Ctrl+J)"]')
        if (!button || button.disabled) return false
        button.click()
        await new Promise(requestAnimationFrame)
      }
      return true
    })()`)
    assert.equal(duplicated, true, 'Não foi possível duplicar duas camadas estilizadas.')
    const multicamadas = await waitFor(evaluate, `(() => {
      const stats = JSON.parse(document.documentElement.dataset.axiaRustStylePreview || 'null')
      const layers = [...document.querySelectorAll('.document-layer')].map(root => {
        const image = root.querySelector('img.layer-image-buffer--active')
        return { id: root.dataset.layerId, source: image?.getAttribute('src'), ready: image?.complete,
          width: image?.naturalWidth }
      })
      return { stats, layers, workers: window.__axiaRustWorkers }
    })()`, value => value?.stats?.consumers === 3 && value.layers.length === 3 &&
      value.layers.every(layer => layer.ready && layer.width === observed.result.naturalWidth) &&
      (rustFallback ? value.stats.fallbacks >= 3 : value.stats.rendered >= 3 && value.stats.resultLeases === 3 &&
        value.stats.service?.active === 0 && value.stats.service?.pending === 0), 'Preview multicamadas')
    assert.equal(multicamadas.workers.created, rustFallback ? 0 : 1)
    assert.equal(multicamadas.workers.peak, rustFallback ? 0 : 1)
    if (!rustFallback) assert.equal(multicamadas.stats.fallbacks, 0)
    const extras = multicamadas.layers.filter(layer => layer.id !== layerId)
    const removedId = extras[0].id, remainingId = extras[1].id, remainingSource = extras[1].source
    async function removeLayer(id) {
      await evaluate(`document.querySelector('.layer-row[data-layer-id=${JSON.stringify(id)}] .layer-button').click()`)
      await waitFor(evaluate,
        `Boolean(document.querySelector('.layer-row[data-layer-id=${JSON.stringify(id)}].layer-row--active'))`, Boolean, 'Camada para remoção')
      assert.equal(await evaluate(`(() => {
        const button = document.querySelector('button[title="Excluir camada (Delete)"]')
        if (!button || button.disabled) return false
        button.click(); return true
      })()`), true)
      await waitFor(evaluate,
        `!document.querySelector('.layer-row[data-layer-id=${JSON.stringify(id)}]')`, Boolean, 'Remoção da camada')
    }
    await removeLayer(removedId)
    const partial = await waitFor(evaluate, 'JSON.parse(document.documentElement.dataset.axiaRustStylePreview || "null")',
      value => value?.consumers === 2 && value.resultLeases === (rustFallback ? 0 : 2), 'Liberação isolada da camada')
    assert.equal(await evaluate('window.__axiaRustWorkers.alive'), rustFallback ? 0 : 1)
    const oldSource = multicamadas.layers.find(layer => layer.id === layerId).source
    await evaluate(`document.querySelector('.layer-row[data-layer-id=${JSON.stringify(layerId)}] .layer-button').click()`)
    await waitFor(evaluate,
      `Boolean(document.querySelector('.layer-row[data-layer-id=${JSON.stringify(layerId)}].layer-row--active'))`, Boolean, 'Camada para edição isolada')
    assert.equal(await evaluate(`(() => {
      const button = [...document.querySelectorAll('.style-thumbnail-apply')]
        .find(item => item.title.startsWith('Aplicar Contorno escuro.'))
      if (!button || button.disabled) return false
      button.click(); return true
    })()`), true)
    const updated = await waitFor(evaluate, `(() => {
      const image = document.querySelector('.document-layer[data-layer-id=${JSON.stringify(layerId)}] img.layer-image-buffer--active')
      const other = document.querySelector('.document-layer[data-layer-id=${JSON.stringify(remainingId)}] img.layer-image-buffer--active')
      return { changed: image?.getAttribute('src') !== ${JSON.stringify(oldSource)}, ready: image?.complete && image.naturalWidth > 0,
        otherSource: other?.getAttribute('src'), stats: JSON.parse(document.documentElement.dataset.axiaRustStylePreview || 'null') }
    })()`, value => value?.changed && value.ready && value.stats.resultLeases === (rustFallback ? 0 : 2), 'Edição isolada com handoff')
    assert.equal(updated.otherSource, remainingSource, 'Editar A modificou o buffer da outra camada.')
    assert.equal(updated.stats.last.backend, rustFallback ? 'legacy' : 'rust')
    assert.equal(await evaluate('window.__axiaRustWorkers.created'), rustFallback ? 0 : 1)
    await removeLayer(remainingId)
    await waitFor(evaluate, 'JSON.parse(document.documentElement.dataset.axiaRustStylePreview || "null")',
      value => value?.consumers === 1 && value.resultLeases === (rustFallback ? 0 : 1), 'Última camada estilizada')
    rustMultilayer = { consumers: multicamadas.stats.consumers, leases: multicamadas.stats.resultLeases,
      workers: multicamadas.workers, partialConsumers: partial.consumers, isolatedUpdate: true }
  }
  let rustCleanup = null
  if (rustMode) {
    const added = await evaluate(`(() => {
      const button = document.querySelector('button[title="Adicionar camada"]')
      if (!button || button.disabled) return false
      button.click()
      return true
    })()`)
    assert.equal(added, true, 'Não foi possível adicionar camada para preservar o documento.')
    await waitFor(evaluate, 'document.querySelectorAll(".layer-row").length', value => value >= 2, 'Camada auxiliar')
    await evaluate(`document.querySelector('.layer-row[data-layer-id=${JSON.stringify(layerId)}] .layer-button').click()`)
    await waitFor(evaluate,
      `Boolean(document.querySelector('.layer-row[data-layer-id=${JSON.stringify(layerId)}].layer-row--active'))`, Boolean, 'Camada estilizada para remoção')
    const deleted = await evaluate(`(() => {
      const button = document.querySelector('button[title="Excluir camada (Delete)"]')
      if (!button || button.disabled) return false
      button.click()
      return true
    })()`)
    assert.equal(deleted, true, 'Não foi possível remover a camada do smoke.')
    rustCleanup = await waitFor(evaluate,
      'JSON.parse(document.documentElement.dataset.axiaRustStylePreview || "null")',
      value => value && !value.occupied && value.resultLeases === 0, 'Liberação das leases no unmount')
    await waitFor(evaluate, 'window.__axiaRustWorkers.alive', value => value === 0, 'Término do Worker compartilhado')
  }
  process.stdout.write(`${JSON.stringify({ status: 'pass', browser: browserVersion,
    platform: process.platform, osRelease: release(), cpu: cpus()[0]?.model,
    node: process.version, go: goVersion, totalMemoryBytes: totalmem(), ...environment, imageBytes: dropped.bytes,
    ...observed.result, screenshot: visual,
    ...(rustMode ? { rustPreview: rustStats, rustMultilayer, rustCleanup } : {}),
    ...(benchmarkMode ? { benchmark: { imageSize, cycles, minimumSampleWindowMs: 500,
      measurement: 'rAF callback cadence, not presented GPU FPS',
      input: 'synthetic wheel and native viewport scroll', samples: frameMetrics } } : {}) })}\n`)
} finally {
  socket?.close()
  if (app && app.exitCode === null) {
    app.kill()
    await Promise.race([new Promise((resolve) => app.once('exit', resolve)), delay(3000)])
  }
  const resolvedStaging = realpathSync(staging)
  const resolvedTemp = realpathSync(tmpdir())
  if (resolvedStaging.startsWith(resolvedTemp + sep)) {
    let cleaned = false
    for (let attempt = 0; attempt < 20; attempt++) {
      try { rmSync(resolvedStaging, { recursive: true, force: true }); cleaned = true; break }
      catch { await delay(250) }
    }
    if (!cleaned) process.stderr.write(`Perfil temporário ainda em uso: ${resolvedStaging}\n`)
  }
}
