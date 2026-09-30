import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const frontendRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const edge = process.env.AXIA_EDGE || (process.platform === 'win32'
  ? 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
  : 'microsoft-edge')
const record = process.argv.includes('--record')
const pipeline = process.argv.includes('--pipeline')
if (record && pipeline) throw new Error('--record e --pipeline são mutuamente exclusivos.')
const pipelineArgs = pipeline ? process.argv.slice(process.argv.indexOf('--pipeline') + 1) : []
const pageName = pipeline ? 'documentPipeline.html' : 'documentOracle.html'
const pageQuery = pipeline
  ? `?width=${encodeURIComponent(pipelineArgs[0] ?? '512')}&height=${encodeURIComponent(pipelineArgs[1] ?? '512')}&samples=${encodeURIComponent(pipelineArgs[2] ?? '5')}`
  : record ? '?record' : ''
const profile = mkdtempSync(join(tmpdir(), 'axia-document-oracle-'))
let vite
let browser
let socket
let viteError
let browserError

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

async function waitForHttp(url) {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (viteError) throw viteError
    if (vite.exitCode !== null) throw new Error(`Vite encerrou antes da sonda: ${vite.exitCode}`)
    try {
      const response = await fetch(url)
      if (response.ok) return
    } catch { /* Server is still starting. */ }
    await delay(100)
  }
  throw new Error(`Vite não serviu ${url} em 20 segundos.`)
}

async function browserPort() {
  const portFile = join(profile, 'DevToolsActivePort')
  for (let attempt = 0; attempt < 200; attempt++) {
    if (browserError) throw browserError
    if (existsSync(portFile)) {
      const port = Number(readFileSync(portFile, 'utf8').split(/\r?\n/)[0])
      if (Number.isInteger(port) && port > 0) return port
    }
    if (browser.exitCode !== null) throw new Error(`Edge encerrou antes do DevTools: ${browser.exitCode}`)
    await delay(100)
  }
  throw new Error('Edge não abriu o DevTools em 20 segundos.')
}

async function pageSocket(port) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page' && target.url.includes(pageName))
      if (page?.webSocketDebuggerUrl) {
        const ws = new WebSocket(page.webSocketDebuggerUrl)
        await new Promise((resolve, reject) => {
          ws.addEventListener('open', resolve, { once: true })
          ws.addEventListener('error', reject, { once: true })
        })
        return ws
      }
    } catch { /* Page is still loading. */ }
    await delay(100)
  }
  throw new Error('Página do oráculo não apareceu no DevTools em 20 segundos.')
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
      entry.reject(new Error('DevTools desconectou.'))
    }
    pending.clear()
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

async function stop(child) {
  if (!child || child.exitCode !== null) return
  child.kill()
  await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(3000)])
}

try {
  const port = await unusedLocalPort()
  const address = `http://127.0.0.1:${port}/benchmarks/${pageName}${pageQuery}`
  vite = spawn(process.execPath, [join(frontendRoot, 'node_modules/vite/bin/vite.js'),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: frontendRoot, windowsHide: true, stdio: 'ignore'
  })
  vite.once('error', (error) => { viteError = error })
  await waitForHttp(address)
  browser = spawn(edge, [
    '--headless=new', '--disable-gpu', '--disable-extensions', '--no-first-run',
    '--no-default-browser-check', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, address
  ], { windowsHide: true, stdio: 'ignore' })
  browser.once('error', (error) => { browserError = error })
  const debugPort = await browserPort()
  socket = await pageSocket(debugPort)
  const evaluate = evaluator(socket)
  let content = 'running'
  for (let attempt = 0; attempt < (pipeline ? 1200 : 200); attempt++) {
    content = await evaluate('document.querySelector("#result")?.textContent')
    if (content && content !== 'running') break
    await delay(100)
  }
  assert.notEqual(content, 'running', `A sonda não concluiu em ${pipeline ? 120 : 20} segundos.`)
  const result = JSON.parse(content)
  assert.equal(result.status, pipeline ? 'benchmark' : record ? 'record' : 'pass', JSON.stringify(result))
  const version = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()
  if (record) {
    const fixture = {
      schemaVersion: 1,
      width: result.width,
      height: result.height,
      recordedWith: { browser: version.Browser, platform: process.platform },
      cases: result.cases.map(({ id, rgba }) => ({
        id,
        maxChannelDifference: 2,
        rows: Array.from({ length: result.height }, (_, y) =>
          Array.from({ length: result.width }, (_, x) =>
            rgba.slice((y * result.width + x) * 4, (y * result.width + x + 1) * 4)
              .map((channel) => channel.toString(16).padStart(2, '0')).join('')
          ).join(' '))
      }))
    }
    process.stdout.write(`${JSON.stringify(fixture, null, 2)}\n`)
  } else {
    process.stdout.write(`${JSON.stringify({ browser: version.Browser, ...result })}\n`)
  }
} finally {
  socket?.close()
  await stop(browser)
  await stop(vite)
  const resolvedProfile = realpathSync(profile)
  const resolvedTemp = realpathSync(tmpdir())
  if (resolvedProfile.startsWith(resolvedTemp + sep)) {
    let cleaned = false
    for (let attempt = 0; attempt < 20; attempt++) {
      try { rmSync(resolvedProfile, { recursive: true, force: true }); cleaned = true; break } catch { await delay(250) }
    }
    if (!cleaned) {
      process.stderr.write(`Perfil temporário do Edge ainda em uso: ${resolvedProfile}\n`)
    }
  }
}
