import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, sep } from 'node:path'

const edge = process.env.AXIA_EDGE || (process.platform === 'win32'
  ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  : 'microsoft-edge')
const address = process.argv[2] ?? 'http://127.0.0.1:34115/?axiaRustPoc=1'
const pageResponse = await fetch(address)
if (!pageResponse.ok) throw new Error(`Preview indisponível: HTTP ${pageResponse.status}`)
const profile = mkdtempSync(join(tmpdir(), 'axia-rust-poc-edge-'))
const child = spawn(edge, [
  '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
  '--no-default-browser-check', '--remote-debugging-port=0',
  `--user-data-dir=${profile}`, address
], { windowsHide: true, stdio: 'ignore' })
let socket

function delay(ms) { return new Promise((resolve) => setTimeout(resolve, ms)) }

async function debugPort() {
  const activePortFile = join(profile, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 100; attempt++) {
    if (existsSync(activePortFile)) {
      const port = Number(readFileSync(activePortFile, 'utf8').split(/\r?\n/)[0])
      if (Number.isInteger(port) && port > 0) return port
    }
    if (child.exitCode !== null) throw new Error(`Edge encerrou antes do DevTools: ${child.exitCode}`)
    await delay(100)
  }
  throw new Error('Edge não abriu o DevTools em 10 segundos.')
}

async function connectPage(port) {
  for (let attempt = 0; attempt < 100; attempt++) {
    let targets
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      targets = await response.json()
    } catch {
      await delay(100)
      continue
    }
    const page = targets.find((target) => target.type === 'page' && target.url.includes('axiaRustPoc=1'))
    if (page?.webSocketDebuggerUrl) {
      const ws = new WebSocket(page.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
        ws.addEventListener('open', resolve, { once: true })
        ws.addEventListener('error', reject, { once: true })
      })
      return ws
    }
    await delay(100)
  }
  throw new Error('Página de diagnóstico não apareceu no DevTools.')
}

function evaluator(ws) {
  let nextId = 0
  const pending = new Map()
  ws.addEventListener('close', () => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timeout)
      waiter.reject(new Error('DevTools encerrou a conexão.'))
    }
    pending.clear()
  })
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    clearTimeout(waiter.timeout)
    if (message.error) waiter.reject(new Error(message.error.message))
    else waiter.resolve(message.result?.result?.value)
  })
  return (expression) => new Promise((resolve, reject) => {
    const id = ++nextId
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error('DevTools não respondeu à avaliação.'))
    }, 5000)
    pending.set(id, { resolve, reject, timeout })
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }))
  })
}

try {
  const port = await debugPort()
  socket = await connectPage(port)
  const evaluate = evaluator(socket)
  let result
  for (let attempt = 0; attempt < 200; attempt++) {
    result = await evaluate('({ status: document.documentElement.dataset.axiaRustPoc, error: document.documentElement.dataset.axiaRustPocError })')
    if (result?.status) break
    await delay(100)
  }
  assert.equal(result?.status, 'passed', `Diagnóstico Edge falhou: ${result?.error ?? 'sem resultado'}`)
  process.stdout.write('Smoke Edge real-time: Worker/WASM empacotados passaram.\n')
} finally {
  socket?.close()
  child.kill()
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)])
  const resolvedProfile = realpathSync(profile)
  const resolvedTemp = realpathSync(tmpdir())
  if (resolvedProfile.startsWith(resolvedTemp + sep)) {
    try { rmSync(resolvedProfile, { recursive: true, force: true }) } catch { /* Edge may still hold its temporary profile. */ }
  }
}
