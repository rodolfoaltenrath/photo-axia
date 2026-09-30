import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'win32') throw new Error('Smoke Wails/WebView2 disponível apenas no Windows.')

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const staging = mkdtempSync(join(tmpdir(), 'axia-rust-wails-smoke-'))
const binary = join(staging, 'axia-rust-poc-smoke.exe')
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
  let lastObservation = 'nenhuma resposta HTTP'
  for (let attempt = 0; attempt < 300; attempt++) {
    if (appError) throw appError
    if (app?.exitCode !== null && app?.exitCode !== undefined) {
      throw new Error(`Axia encerrou antes de abrir o WebView2: ${app.exitCode}`)
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const pages = await response.json()
      lastObservation = `HTTP ${response.status}: ${JSON.stringify(pages.map((page) => ({ type: page.type, url: page.url }))).slice(0, 900)}`
      const target = pages.find((page) => page.type === 'page' && page.url.includes('axiaRustPoc=1'))
      if (target?.webSocketDebuggerUrl) return target
    } catch (error) { lastObservation = error instanceof Error ? error.message : String(error) }
    await delay(100)
  }
  throw new Error(`WebView2 não expôs a página diagnóstica em 30 segundos. ${lastObservation} Logs: ${appOutput.slice(-1600)}`)
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
    else entry.resolve(message.result?.result?.value)
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
    }, 5000)
    pending.set(id, { resolve, reject, timeout })
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  })
}

try {
  const build = spawnSync('go', [
    'build', '-tags', 'production', '-trimpath', '-buildvcs=false', '-o', binary, '.'
  ], { cwd: repoRoot, windowsHide: true, stdio: 'inherit' })
  if (build.error) throw build.error
  if (build.status !== 0) throw new Error(`go build falhou: ${build.status}`)

  const port = await unusedLocalPort()
  app = spawn(binary, ['--axia-rust-poc-smoke'], {
    cwd: repoRoot,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      ...process.env,
      AXIA_RUST_POC_CDP_PORT: String(port),
      AXIA_RUST_POC_WEBVIEW_DATA: webviewData
    }
  })
  app.once('error', (error) => { appError = error })
  for (const stream of [app.stdout, app.stderr]) {
    stream.on('data', (chunk) => { appOutput = (appOutput + chunk.toString()).slice(-4000) })
  }
  const target = await targetAt(port)
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  const evaluate = evaluator(socket)
  let result
  for (let attempt = 0; attempt < 300; attempt++) {
    result = await evaluate('({ status: document.documentElement.dataset.axiaRustPoc, error: document.documentElement.dataset.axiaRustPocError })')
    if (result?.status) break
    await delay(100)
  }
  assert.equal(result?.status, 'passed', `Diagnóstico Wails/WebView2 falhou: ${result?.error ?? 'sem resultado'}`)
  process.stdout.write('Smoke Wails/WebView2: Worker/WASM incorporados ao executável passaram.\n')
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
      try {
        rmSync(resolvedStaging, { recursive: true, force: true })
        cleaned = true
        break
      } catch {
        await delay(250)
      }
    }
    if (!cleaned) {
      process.stderr.write(`Perfil temporário ainda em uso: ${resolvedStaging}\n`)
    }
  }
}
