// Grava a saída real do Canvas 2D para medir paridade do kernel Rust fora do oráculo headless.
//
//   node scripts/recordCanvasReferences.mjs --target webview2|headless --suite resampling|minification [--out arquivo]
//
// webview2: executável de produção Wails (WebView2 distribuído, contexto real do app).
// headless: Edge headless com --disable-gpu em about:blank (o ambiente do oráculo de CI).
// As suítes usam apenas APIs de Canvas, então rodam iguais nos dois alvos.
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const option = (name, fallback) => {
  const index = process.argv.indexOf(name)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const target = option('--target', 'webview2')
const suite = option('--suite', 'resampling')
if (!['webview2', 'headless'].includes(target) || !['resampling', 'minification'].includes(suite)) {
  throw new Error('Use --target webview2|headless e --suite resampling|minification.')
}
const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const output = resolve(option('--out', join(repoRoot, 'frontend/tests/fixtures',
  `${target}${suite[0].toUpperCase()}${suite.slice(1)}.v1.json`)))
const staging = mkdtempSync(join(tmpdir(), `axia-canvas-${target}-`))
const delay = (ms) => new Promise((done) => setTimeout(done, ms))
let child, socket

async function unusedLocalPort() {
  const server = createServer()
  await new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done) })
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}

async function pageTarget(port, matches) {
  for (let attempt = 0; attempt < 300; attempt++) {
    if (child.exitCode !== null) throw new Error(`Processo encerrou antes do DevTools: ${child.exitCode}`)
    try {
      const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = pages.find((item) => item.type === 'page' && matches(item.url))
      if (page?.webSocketDebuggerUrl) return page
    } catch { /* ainda subindo */ }
    await delay(100)
  }
  throw new Error('DevTools não expôs a página em 30 s.')
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
  return (expression, timeoutMs = 120_000) => new Promise((done, fail) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); fail(new Error('DevTools não respondeu.')) }, timeoutMs)
    pending.set(id, { resolve: (value) => { clearTimeout(timer); done(value) }, reject: (error) => { clearTimeout(timer); fail(error) } })
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true, awaitPromise: true } }))
  })
}

// Prelúdio comum: fonte → PNG → HTMLImageElement, e o desenho com a mesma convenção do
// diagnóstico (setTransform rotacional normalizado + drawImage com o tamanho em escala).
const prelude = `
  const operation = (mode) => mode === 'normal' ? 'source-over' : mode
  async function sourceImage(values, size) {
    const source = new OffscreenCanvas(size, size), context = source.getContext('2d')
    context.putImageData(new ImageData(new Uint8ClampedArray(values), size, size), 0, 0)
    const rgba = [...context.getImageData(0, 0, size, size).data]
    const image = new Image(), url = URL.createObjectURL(await source.convertToBlob({ type: 'image/png' }))
    image.src = url; await image.decode()
    return { rgba, image, release: () => URL.revokeObjectURL(url) }
  }
  function draw(out, image, size, matrix, mode, opacity) {
    const [a, b, c, d, tx, ty] = matrix, sx = Math.hypot(a, b), sy = Math.hypot(c, d), half = size / 2
    out.globalAlpha = opacity / 100; out.globalCompositeOperation = operation(mode)
    out.setTransform(a / sx, b / sx, c / sy, d / sy, tx + (a + c) * half, ty + (b + d) * half)
    out.drawImage(image, -sx * half, -sy * half, size * sx, size * sy)
  }
  const contexts = [['read-frequent', { willReadFrequently: true }, 0], ['default-512', undefined, 512]]
`

const suites = {
  // Mesmas fontes, matrizes, fundo e opacidade de rustDocumentResamplingDiagnostic.ts.
  resampling: `(async () => {${prelude}
    const width = 16, height = 12, size = 2, opacity = 63.7, backdrop = [20, 80, 160, 109]
    const modes = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']
    const matrices = [
      [1, 0, 0, 1, 2, 2], [1, 0, 0, 1, 2.25, 2], [1, 0, 0, 1, 2.5, 2.25], [1, 0, 0, 1, 2.75, 2.5],
      [1, 0, 0, 1, -0.5, -0.25], [1, 0, 0, 1, -0.75, -0.5],
      [2, 0, 0, 2, 2, 2], [1.5, 0, 0, 1.5, 2, 2], [2, 0, 0, 2, 2.25, 2.5], [1.5, 0, 0, 1.5, 2.25, 2.5],
      [3.25, 0, 0, 1.5, 0.125, 1.375], [1.125, 0, 0, 2.25, 0.5, 0.75],
      [0, 1, -1, 0, 4.5, 2.25], [0, -1.5, 2, 0, 0.25, 4.5], [-1.5, 0, 0, 2, 5.25, 0.5], [-1, 0, 0, -1, 3.5, 2.75]
    ]
    const values = [
      [255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255],
      [255, 0, 0, 255, 0, 255, 0, 109, 0, 0, 255, 0, 255, 255, 255, 128],
      [20, 96, 255, 109, 7, 237, 51, 1, 192, 80, 40, 255, 255, 200, 100, 128]
    ]
    return record({ width, height, size, opacity, backdrop, modes, matrices, values })
  })()`,
  // Varredura fina da redução para localizar a troca de kernel do Chromium (mipmap).
  minification: `(async () => {${prelude}
    const width = 24, height = 20, size = 16, opacity = 63.7, backdrop = [20, 80, 160, 109]
    const modes = ['normal', 'multiply']
    const scales = [0.3, 0.4, 0.45, 0.48, 0.5, 0.505, 0.51, 0.52, 0.53, 0.54, 0.55, 0.6, 0.7, 0.8, 0.9, 0.99]
    const matrices = []
    for (const s of scales) for (const t of [0, 0.3125, 0.75]) {
      matrices.push([s, 0, 0, s, 2 + t, 1.5 + t], [0, s, -s, 0, 14 + t, 1 + t], [-s, 0, 0, 0.9, 20 - t, 2 + t])
    }
    let seed = 7
    const random = Array.from({ length: size * size * 4 }, () => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 24)
    for (let i = 3; i < random.length; i += 8) random[i] = 255
    const ramp = Array.from({ length: size * size }, (_, i) => [i % size * 16, (i >> 4) * 16, 128, 255]).flat()
    return record({ width, height, size, opacity, backdrop, modes, matrices, values: [random, ramp] })
  })()`
}

// record() executa a matriz de casos em cada contexto e devolve RGBA em base64.
const recordFunction = `
  async function record({ width, height, size, opacity, backdrop, modes, matrices, values }) {
    const bottom = new OffscreenCanvas(1, 1)
    bottom.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(backdrop), 1, 1), 0, 0)
    const sources = [], cases = []
    const base64 = (data) => { let s = ''; for (const v of data) s += String.fromCharCode(v); return btoa(s) }
    for (const [sourceIndex, sourceValues] of values.entries()) {
      const source = await sourceImage(sourceValues, size)
      sources.push(source.rgba)
      try {
        for (const [context, options, side] of contexts) {
          const canvas = document.createElement('canvas')
          canvas.width = side || width; canvas.height = side || height
          const out = canvas.getContext('2d', options)
          for (const [matrixIndex, matrix] of matrices.entries()) for (const mode of modes) {
            out.resetTransform(); out.globalAlpha = 1; out.globalCompositeOperation = 'source-over'
            out.clearRect(0, 0, canvas.width, canvas.height); out.drawImage(bottom, 0, 0, width, height)
            draw(out, source.image, size, matrix, mode, opacity)
            cases.push({ sourceIndex, matrixIndex, mode, context, rgba: base64(out.getImageData(0, 0, width, height).data) })
          }
          canvas.width = 1; canvas.height = 1
        }
      } finally { source.release() }
    }
    return { userAgent: navigator.userAgent, width, height, size, opacity, backdrop, modes, matrices, sources, cases }
  }
`

async function launch() {
  const port = await unusedLocalPort()
  if (target === 'webview2') {
    const binary = join(staging, process.platform === 'win32' ? 'axia-record.exe' : 'axia-record')
    const build = spawnSync('go', ['build', '-tags', 'production', '-trimpath', '-buildvcs=false', '-o', binary, '.'],
      { cwd: repoRoot, windowsHide: true, stdio: 'inherit' })
    if (build.status !== 0) throw new Error(`go build falhou: ${build.status}`)
    child = spawn(binary, ['--axia-rust-poc-smoke'], { cwd: repoRoot, windowsHide: true, stdio: 'ignore',
      env: { ...process.env, AXIA_RUST_POC_CDP_PORT: String(port), AXIA_RUST_POC_WEBVIEW_DATA: join(staging, 'webview') } })
    return pageTarget(port, (url) => url.includes('axiaRustPoc=1'))
  }
  const edge = process.env.AXIA_EDGE || (process.platform === 'win32'
    ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe' : 'microsoft-edge')
  if (process.platform === 'win32' && !existsSync(edge)) throw new Error(`Edge ausente: ${edge}`)
  child = spawn(edge, ['--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
    '--no-default-browser-check', `--remote-debugging-port=${port}`, `--user-data-dir=${join(staging, 'profile')}`,
    'about:blank'], { windowsHide: true, stdio: 'ignore' })
  return pageTarget(port, (url) => url === 'about:blank')
}

try {
  const page = await launch()
  socket = new WebSocket(page.webSocketDebuggerUrl)
  await new Promise((done, fail) => { socket.addEventListener('open', done, { once: true }); socket.addEventListener('error', fail, { once: true }) })
  const evaluate = evaluator(socket)
  if (target === 'webview2') {
    // Espera o diagnóstico do app terminar para não disputar a thread principal com ele.
    for (let attempt = 0; attempt < 600; attempt++) {
      if (await evaluate('document.documentElement.dataset.axiaRustPoc', 10_000)) break
      await delay(100)
    }
  }
  const result = await evaluate(suites[suite].replace(`(async () => {${prelude}`, `(async () => {${prelude}${recordFunction}`))
  if (!result?.cases?.length) throw new Error('Gravação vazia.')
  writeFileSync(output, `${JSON.stringify({ schemaVersion: 1, suite, target, recordedAt: new Date().toISOString().slice(0, 10),
    encoding: 'rgba-base64', ...result })}\n`)
  process.stdout.write(`${result.cases.length} casos (${suite}) de ${result.userAgent}\n${output}\n`)
} finally {
  socket?.close()
  if (child && child.exitCode === null) { child.kill(); await Promise.race([new Promise((done) => child.once('exit', done)), delay(3000)]) }
  const resolved = realpathSync(staging)
  if (resolved.startsWith(realpathSync(tmpdir()) + sep)) {
    for (let attempt = 0; attempt < 20; attempt++) {
      try { rmSync(resolved, { recursive: true, force: true }); break } catch { await delay(250) }
    }
  }
}
