export interface PreviewFrameSample {
  label: string
  started: number
  ended: number
  callbacks: number[]
  longTasks: { startTime: number; duration: number }[]
  longTasksSupported: boolean
  visibilityChanged: boolean
  operationMs: number
  lostActive: boolean
  navigation?: { maximumScaleChange?: number; maximumScrollChange?: number; restored: boolean }
}

export function summarizePreviewFrames(sample: PreviewFrameSample) {
  const durationMs = sample.ended - sample.started
  if (!Number.isFinite(durationMs) || durationMs <= 0 ||
      sample.callbacks.some((time, index) => !Number.isFinite(time) ||
        time < sample.started || time > sample.ended ||
        (index > 0 && time <= sample.callbacks[index - 1]!))) {
    throw new Error('invalid-frame-sample')
  }
  const intervals = sample.callbacks.slice(1).map((time, index) => time - sample.callbacks[index]!)
  const sorted = [...intervals].sort((a, b) => a - b)
  const percentile = (fraction: number) => sorted.length
    ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)]! : null
  // Include boundary gaps: a blocked phase with zero/one callback must not look smooth.
  const boundaries = [sample.started, ...sample.callbacks, sample.ended]
  const gaps = boundaries.slice(1).map((time, index) => time - boundaries[index]!)
  const tasks = sample.longTasks.map((task) => ({
    start: Math.max(sample.started, task.startTime),
    end: Math.min(sample.ended, task.startTime + task.duration)
  })).filter((task) => task.end > task.start)
  return {
    label: sample.label, durationMs, operationMs: sample.operationMs,
    callbackCount: sample.callbacks.length,
    callbackRateHz: sample.callbacks.length * 1000 / durationMs,
    medianCallbackIntervalMs: percentile(0.5), p95CallbackIntervalMs: percentile(0.95),
    maxCallbackGapMs: Math.max(...gaps), gapsOver50Ms: gaps.filter((gap) => gap > 50).length,
    longTaskCount: sample.longTasksSupported ? tasks.length : null,
    longTaskMs: sample.longTasksSupported ? tasks.reduce((sum, task) => sum + task.end - task.start, 0) : null,
    visibilityChanged: sample.visibilityChanged, lostActive: sample.lostActive,
    ...(sample.navigation ? { navigation: sample.navigation } : {})
  }
}

/** Serialized into CDP Runtime.evaluate; keep all browser dependencies inside this function. */
export async function runPreviewWailsProbe(layerId: string, cycles: number): Promise<PreviewFrameSample[]> {
  const root = document.querySelector<HTMLElement>(`.document-layer[data-layer-id="${CSS.escape(layerId)}"]`)
  const viewport = document.querySelector<HTMLElement>('.canvas-scroll')
  if (!root || !viewport) throw new Error('Preview ausente para o benchmark.')
  if (document.visibilityState !== 'visible') throw new Error('Preview oculto: cadência de frames inválida.')
  const active = () => root.querySelector<HTMLImageElement>('img.layer-image-buffer--active')
  const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
  const samples: PreviewFrameSample[] = []

  async function measure(label: string, operation: () => Promise<void>) {
    const sample: PreviewFrameSample = {
      label, started: performance.now(), ended: 0, callbacks: [], longTasks: [],
      longTasksSupported: PerformanceObserver.supportedEntryTypes.includes('longtask'),
      visibilityChanged: false, operationMs: 0, lostActive: false
    }
    const collect = (entries: PerformanceEntry[]) => {
      for (const entry of entries) sample.longTasks.push({ startTime: entry.startTime, duration: entry.duration })
    }
    const observer = sample.longTasksSupported ? new PerformanceObserver((list) => collect(list.getEntries())) : null
    observer?.observe({ entryTypes: ['longtask'] })
    const visibility = () => { if (document.visibilityState !== 'visible') sample.visibilityChanged = true }
    document.addEventListener('visibilitychange', visibility)
    const inspect = () => { if (!active()) sample.lostActive = true }
    const mutations = new MutationObserver(inspect)
    mutations.observe(root!, { attributes: true, childList: true, subtree: true, attributeFilter: ['class', 'src'] })
    let frameId = 0
    function tick() {
      sample.callbacks.push(performance.now())
      inspect()
      frameId = requestAnimationFrame(tick)
    }
    frameId = requestAnimationFrame(tick)
    try {
      await operation()
      sample.operationMs = performance.now() - sample.started
      // A common minimum window provides enough callbacks for short cached operations.
      while (performance.now() - sample.started < 500) {
        await wait(Math.max(1, 500 - (performance.now() - sample.started)))
      }
      await frame()
      sample.ended = performance.now()
      collect(observer?.takeRecords() ?? [])
      samples.push(sample)
    } finally {
      cancelAnimationFrame(frameId)
      observer?.disconnect()
      mutations.disconnect()
      document.removeEventListener('visibilitychange', visibility)
    }
    if (sample.visibilityChanged) throw new Error(`Preview ocultado durante ${label}.`)
    if (sample.lostActive) throw new Error(`Preview sem buffer ativo durante ${label}.`)
    const error = document.querySelector('.error-banner')?.textContent?.trim()
    if (error) throw new Error(`Editor recusou ${label}: ${error}`)
  }

  await measure('idle', () => wait(1000))
  for (let cycle = 0; cycle < cycles; cycle++) {
    // The smoke already applied shadow. First stroke/glow use and later repeats are labeled separately.
    for (const name of ['Contorno escuro', 'Brilho suave', 'Sombra suave']) {
      await measure(`style:${name}:cycle-${cycle + 1}`, async () => {
        const initial = active()?.getAttribute('src')
        const preset = Array.from(document.querySelectorAll<HTMLButtonElement>('.style-thumbnail-apply'))
          .find((button) => button.title.startsWith(`Aplicar ${name}.`))
        if (!initial || !preset || preset.disabled) throw new Error(`Preset indisponível: ${name}.`)
        preset.click()
        const deadline = performance.now() + 10_000
        while (true) {
          const current = active()
          if (current?.getAttribute('src') !== initial && current?.complete && current.naturalWidth > 0) break
          if (performance.now() > deadline) throw new Error(`Handoff não concluiu: ${name}.`)
          await frame()
        }
        await frame()
        await frame()
      })
    }
  }

  const surface = document.querySelector<HTMLElement>('.canvas-surface')
  if (!surface) throw new Error('Superfície ausente para medir zoom.')
  const beforeZoom = surface.getBoundingClientRect().width
  let maximumScaleChange = 0
  await measure('animated-wheel-zoom', async () => {
    const rect = viewport!.getBoundingClientRect()
    for (const deltaY of [-80, -80, -80, 80, 80, 80]) {
      viewport!.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true, cancelable: true, ctrlKey: true, deltaY,
        clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2
      }))
      await wait(80)
      maximumScaleChange = Math.max(maximumScaleChange,
        Math.abs(surface!.getBoundingClientRect().width / beforeZoom - 1))
    }
    // Wait for the animated visual scale and pending scroll anchor to settle.
    let previous = surface!.getBoundingClientRect().width
    let stable = 0
    const deadline = performance.now() + 5000
    while (stable < 8) {
      await frame()
      const width = surface!.getBoundingClientRect().width
      stable = Math.abs(width - previous) < 0.001 ? stable + 1 : 0
      previous = width
      if (performance.now() > deadline) throw new Error('Zoom não estabilizou.')
    }
  })
  if (maximumScaleChange < 0.01) throw new Error('O benchmark não alterou o zoom do preview.')
  const zoomRestored = Math.abs(surface.getBoundingClientRect().width - beforeZoom) <= 1
  samples[samples.length - 1]!.navigation = { maximumScaleChange, restored: zoomRestored }
  if (!zoomRestored) {
    throw new Error('Zoom de ida/volta não restaurou a escala inicial.')
  }

  const initialLeft = viewport.scrollLeft
  const initialTop = viewport.scrollTop
  let maximumScrollChange = 0
  await measure('native-scroll-pan', async () => {
    for (let step = 0; step < 60; step++) {
      const offset = Math.sin((step + 1) / 60 * Math.PI * 2) * 80
      viewport!.scrollLeft = initialLeft + offset
      viewport!.scrollTop = initialTop + offset / 2
      maximumScrollChange = Math.max(maximumScrollChange, Math.abs(viewport!.scrollLeft - initialLeft))
      await frame()
    }
    viewport!.scrollLeft = initialLeft
    viewport!.scrollTop = initialTop
    await frame()
    await frame()
  })
  const scrollRestored = Math.abs(viewport.scrollLeft - initialLeft) <= 1 &&
    Math.abs(viewport.scrollTop - initialTop) <= 1
  samples[samples.length - 1]!.navigation = { maximumScrollChange, restored: scrollRestored }
  if (maximumScrollChange <= 1 || !scrollRestored) throw new Error('Pan não moveu/restaurou o viewport.')
  return samples
}
