let compatibility: Promise<boolean> | undefined

/**
 * O recorte raster do Rust inclui o pixel `i` quando `floor(início + 0,5) <= i < floor(fim + 0,5)`:
 * centro exatamente na borda fica fora no início e dentro no fim. O Skia não decide esse empate
 * igual em todo ambiente — o WebView2 medido em 2026-10-26 arredonda para o lado negativo, o Edge
 * headless para o positivo. Verifica início e fim nos dois eixos, não só o início em y.
 */
function tiesRoundTowardPositive(output: HTMLCanvasElement, content: CanvasImageSource, size: number) {
  for (const [tx, ty, outside, inside] of [
    [3.5, 3.25, [2, 3], [4, 3]], // bordas em x = 2,5 e 4,5
    [3.25, 3.5, [3, 2], [3, 4]] // bordas em y = 2,5 e 4,5
  ] as const) {
    output.width = size; output.height = size
    const context = output.getContext('2d')
    if (!context) return false
    context.translate(tx, ty)
    context.drawImage(content, -1, -1, 2, 2)
    if (context.getImageData(outside[0], outside[1], 1, 1).data[3] !== 0 ||
        context.getImageData(inside[0], inside[1], 1, 1).data[3] === 0) return false
  }
  return true
}

export function rustDocumentSamplingCompatible() {
  return compatibility ??= probeCompatibility()
}

async function probeCompatibility() {
  const source = document.createElement('canvas'), output = document.createElement('canvas'), image = new Image()
  let bitmap: ImageBitmap | undefined, expired = false, timeout: ReturnType<typeof setTimeout> | undefined
  const probe = async () => {
    try {
      source.width = 2; source.height = 2
      const input = source.getContext('2d')
      if (!input) return false
      input.putImageData(new ImageData(new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]), 2, 2), 0, 0)
      image.src = source.toDataURL('image/png'); await image.decode()
      if (expired) return false
      bitmap = await createImageBitmap(source)
      if (expired) { bitmap.close(); return false }
      for (const size of [16, 512]) for (const content of [image, bitmap]) for (const scale of [1, 1.5]) {
        if (expired) return false
        output.width = size; output.height = size
        const context = output.getContext('2d')
        if (!context) return false
        context.translate(2.25 + scale, 2.5 + scale)
        context.drawImage(content, -scale, -scale, 2 * scale, 2 * scale)
        const corner = context.getImageData(2, 2, 1, 1).data, middle = context.getImageData(3, 3, 1, 1).data
        const expected = scale === 1 ? [128, 191, 128, 255] : [164, 80, 32, 255]
        if (corner[3] !== 0 || expected.some((value, index) => Math.abs(value - middle[index]!) > 2)) return false
        if (scale === 1 && !tiesRoundTowardPositive(output, content, size)) return false
      }
      return true
    } catch { return false }
  }
  try {
    return await Promise.race([probe(), new Promise<boolean>(resolve => {
      timeout = setTimeout(() => { expired = true; resolve(false) }, 2_000)
    })])
  } finally {
    expired = true; clearTimeout(timeout); image.src = ''; bitmap?.close()
    source.width = 1; source.height = 1; output.width = 1; output.height = 1
  }
}
