// Grava a saída real do Canvas do WebView2 nos casos de reamostragem raster.
// O oráculo headless não representa o WebView2 distribuído (ver contrato de
// reamostragem, seção 5.1); estas referências permitem iterar o kernel Rust em
// Node contra o ambiente real sem abrir o aplicativo a cada tentativa.
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const output = resolve(repoRoot, 'frontend/tests/fixtures/webview2Resampling.v1.json')
const staging = mkdtempSync(join(tmpdir(), 'axia-webview2-resampling-'))
const binary = join(staging, process.platform === 'win32' ? 'axia-record.exe' : 'axia-record')
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
let app, socket

async function unusedLocalPort() {
  const server = createServer()
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done) })
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}

async function pageTarget(port) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (app.exitCode !== null) throw new Error(`Axia encerrou antes do WebView2: ${app.exitCode}`)
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const target = pages.find((page) => page.type === 'page' && page.url.includes('axiaRustPoc=1'))
      if (target?.webSocketDebuggerUrl) return target
    } catch { /* WebView2 ainda subindo */ }
    await delay(100)
  }
  throw new Error('WebView2 não expôs a página em 30 s.')
}

function evaluator(ws) {
  let nextId = 0
  const pending = new Map()
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (!entry) return
    pending.delete(message.id)
    if (message.error || message.result?.exceptionDetails) {
      entry.reject(new Error(JSON.stringify(message.error ?? message.result.exceptionDetails).slice(0, 600)))
    } else entry.resolve(message.result?.result?.value)
  })
  return (expression, timeoutMs = 60_000) => new Promise((done, fail) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); fail(new Error('DevTools não respondeu.')) }, timeoutMs)
    pending.set(id, { resolve: (value) => { clearTimeout(timer); done(value) }, reject: (error) => { clearTimeout(timer); fail(error) } })
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}

// Mesmas fontes, matrizes, fundo, opacidade e chamadas de Canvas de rustDocumentResamplingDiagnostic.ts.
const recording = `(async () => {
  const width = 16, height = 12
  const modes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']
  const operation = (mode) => mode === 'normal' ? 'source-over' : mode
  const matrices = [
    [1, 0, 0, 1, 2, 2], [1, 0, 0, 1, 2.25, 2], [1, 0, 0, 1, 2.5, 2.25], [1, 0, 0, 1, 2.75, 2.5],
    [1, 0, 0, 1, -0.5, -0.25], [1, 0, 0, 1, -0.75, -0.5],
    [2, 0, 0, 2, 2, 2], [1.5, 0, 0, 1.5, 2, 2], [2, 0, 0, 2, 2.25, 2.5], [1.5, 0, 0, 1.5, 2.25, 2.5],
    [3.25, 0, 0, 1.5, 0.125, 1.375], [1.125, 0, 0, 2.25, 0.5, 0.75],
    [0, 1, -1, 0, 4.5, 2.25], [0, -1.5, 2, 0, 0.25, 4.5], [-1.5, 0, 0, 2, 5.25, 0.5], [-1, 0, 0, -1, 3.5, 2.75]
  ]
  const sourcesValues = [
    [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255],
    [255, 0, 0, 255, 0, 255, 0, 109, 0, 0, 255, 0, 255, 255, 255, 128],
    [20, 96, 255, 109, 7, 237, 51, 1, 192, 80, 40, 255, 255, 200, 100, 128]
  ]
  const backdrop = [20, 80, 160, 109]
  const bottom = new OffscreenCanvas(1, 1)
  bottom.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(backdrop), 1, 1), 0, 0)
  const sources = [], cases = []
  for (const [sourceIndex, values] of sourcesValues.entries()) {
    const source = new OffscreenCanvas(2, 2), context = source.getContext('2d')
    context.putImageData(new ImageData(new Uint8ClampedArray(values), 2, 2), 0, 0)
    const rgba = [...context.getImageData(0, 0, 2, 2).data]
    sources.push(rgba)
    const image = new Image(), url = URL.createObjectURL(await source.convertToBlob({ type: 'image/png' }))
    try {
      image.src = url; await image.decode()
      for (const contextKind of ['read-frequent-16', 'default-512']) {
        const canvas = document.createElement('canvas')
        canvas.width = contextKind === 'read-frequent-16' ? width : 512
        canvas.height = contextKind === 'read-frequent-16' ? height : 512
        const out = canvas.getContext('2d', contextKind === 'read-frequent-16' ? { willReadFrequently: true } : undefined)
        for (const [matrixIndex, matrix] of matrices.entries()) for (const mode of modes) {
          out.resetTransform(); out.globalAlpha = 1; out.globalCompositeOperation = 'source-over'
          out.clearRect(0, 0, canvas.width, canvas.height); out.drawImage(bottom, 0, 0, width, height)
          out.globalAlpha = 0.637; out.globalCompositeOperation = operation(mode)
          const [a, b, c, d, tx, ty] = matrix, sx = Math.hypot(a, b), sy = Math.hypot(c, d)
          out.setTransform(a / sx, b / sx, c / sy, d / sy, tx + a + c, ty + b + d)
          out.drawImage(image, -sx, -sy, 2 * sx, 2 * sy)
          cases.push({ sourceIndex, matrixIndex, mode, context: contextKind, rgba: [...out.getImageData(0, 0, width, height).data] })
        }
        canvas.width = 1; canvas.height = 1
      }
    } finally { URL.revokeObjectURL(url) }
  }
  return { userAgent: navigator.userAgent, width, height, backdrop, opacity: 63.7, matrices, modes, sources, cases }
})()`

try {
  const build = spawnSync('go', ['build', '-tags', 'production', '-trimpath', '-buildvcs=false', '-o', binary, '.'],
    { cwd: repoRoot, windowsHide: true, stdio: 'inherit' })
  if (build.status !== 0) throw new Error(`go build falhou: ${build.status}`)
  const port = await unusedLocalPort()
  app = spawn(binary, ['--axia-rust-poc-smoke'], {
    cwd: repoRoot, windowsHide: true, stdio: 'ignore',
    env: { ...process.env, AXIA_RUST_POC_CDP_PORT: String(port), AXIA_RUST_POC_WEBVIEW_DATA: join(staging, 'webview') }
  })
  const target = await pageTarget(port)
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }) })
  const evaluate = evaluator(socket)
  // Espera o diagnóstico terminar para não disputar a thread principal com ele.
  for (let attempt = 0; attempt < 600; attempt++) {
    if (await evaluate('document.documentElement.dataset.axiaRustPoc', 10_000)) break
    await delay(100)
  }
  const result = await evaluate(recording)
  if (!result?.cases?.length) throw new Error('Gravação vazia.')
  // RGBA em base64: o JSON numérico de 576 casos passava de 1,6 MB.
  const cases = result.cases.map(({ rgba, ...item }) => ({ ...item, rgba: Buffer.from(rgba).toString('base64') }))
  writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, recordedAt: new Date().toISOString().slice(0, 10),
    encoding: 'rgba-base64', ...result, cases })}\n`)
  process.stdout.write(`${result.cases.length} casos gravados de ${result.userAgent}\n${output}\n`)
} finally {
  socket?.close()
  if (app && app.exitCode === null) { app.kill(); await Promise.race([new Promise((done) => app.once('exit', done)), delay(3000)]) }
  const resolved = realpathSync(staging)
  if (resolved.startsWith(realpathSync(tmpdir()) + sep)) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try { rmSync(resolved, { recursive: true, force: true }); break } catch { await delay(250) }
    }
  }
}
