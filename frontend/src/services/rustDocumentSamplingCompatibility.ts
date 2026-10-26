let compatibility: Promise<boolean> | undefined

/**
 * Confere se o `drawImage` da plataforma usa o mesmo kernel bilinear do Rust, a menos das duas
 * variações legítimas do próprio Chromium (ver rustRasterParity.ts): direção de empate em borda
 * e precisão dos pesos. Por isso as amostras evitam pixels de empate e usam frações múltiplas de
 * 1/16, em que pesos quantizados e exatos coincidem. Uma plataforma que filtre de outro modo
 * (vizinho mais próximo, mipmap, blur) reprova e mantém o fallback.
 */
const PROBES = [
  // [escala, translação x, translação y, valor esperado no pixel (3,3)]
  [1, 3.25, 3.5, [128, 191, 128, 255]],
  [2, 4.25, 4.375, [211, 32, 16, 255]]
] as const

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
      // 16 px tende a ficar na CPU; 512 px pode ser acelerado por GPU, como o canvas de exportação.
      for (const size of [16, 512]) for (const content of [image, bitmap]) for (const [scale, tx, ty, expected] of PROBES) {
        if (expired) return false
        output.width = size; output.height = size
        const context = output.getContext('2d')
        if (!context) return false
        context.translate(tx, ty)
        context.drawImage(content, -scale, -scale, 2 * scale, 2 * scale)
        // (1,1) está longe de qualquer borda: nada pode vazar para fora da fonte.
        const outside = context.getImageData(1, 1, 1, 1).data, middle = context.getImageData(3, 3, 1, 1).data
        if (outside[3] !== 0 || expected.some((value, index) => Math.abs(value - middle[index]!) > 2)) return false
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
