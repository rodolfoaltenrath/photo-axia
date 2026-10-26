/**
 * Paridade entre o kernel raster Rust e o `drawImage` do Canvas.
 *
 * Medição no WebView2 (Chromium 155) e no Edge headless (156) mostrou que o próprio
 * Chromium varia em exatamente dois pontos, conforme versão, contexto CPU/GPU e
 * presença de alfa na imagem (ver contrato de reamostragem, seção 5.2):
 *
 * 1. Pixel de empate: centro exatamente sobre uma borda da fonte transformada pode
 *    ficar dentro ou fora. As duas rasterizações são válidas; o Rust fixa a sua.
 * 2. Precisão dos pesos bilineares: quantizados em 1/16 ou exatos.
 *
 * Fora disso a comparação continua estrita. Estes utilitários aplicam as duas
 * exceções e nada mais; não ampliam tolerância.
 */
export const RASTER_ALPHA_TOLERANCE = 2
export const RASTER_PREMULTIPLIED_TOLERANCE = 3
const TIE_EPSILON = 1e-6

export interface RasterSourceEdges { x: readonly number[]; y: readonly number[] }

/** Bordas da fonte `width × height` transformada por uma matriz alinhada a eixos, em pixels de saída. */
export function rasterSourceEdges(matrix: readonly number[], width: number, height: number,
  originX = 0, originY = 0): RasterSourceEdges {
  const [a, b, c, d, tx, ty] = matrix as [number, number, number, number, number, number]
  const xs = [0, width].flatMap(u => [0, height].map(v => a * u + c * v + tx - originX))
  const ys = [0, width].flatMap(u => [0, height].map(v => b * u + d * v + ty - originY))
  return { x: [Math.min(...xs), Math.max(...xs)], y: [Math.min(...ys), Math.max(...ys)] }
}

export function rasterPixelIsTie(x: number, y: number, edges: readonly RasterSourceEdges[]) {
  return edges.some(edge => edge.x.some(value => Math.abs(x + 0.5 - value) < TIE_EPSILON) ||
    edge.y.some(value => Math.abs(y + 0.5 - value) < TIE_EPSILON))
}

/** Maior diferença de alfa e de RGB premultiplicado, ignorando apenas pixels de empate. */
export function rasterParityDifference(expected: ArrayLike<number>, actual: ArrayLike<number>,
  width: number, height: number, edges: readonly RasterSourceEdges[] = []) {
  if (expected.length !== width * height * 4 || actual.length !== expected.length) throw new Error('Dimensões de paridade divergentes.')
  let alpha = 0, color = 0, ignored = 0
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (rasterPixelIsTie(x, y, edges)) { ignored++; continue }
    const i = (y * width + x) * 4
    alpha = Math.max(alpha, Math.abs(actual[i + 3]! - expected[i + 3]!))
    for (let c = 0; c < 3; c++) {
      color = Math.max(color, Math.abs(actual[i + c]! * actual[i + 3]! / 255 - expected[i + c]! * expected[i + 3]! / 255))
    }
  }
  return { alpha, color, ignored }
}

export function rasterParityWithin(difference: { alpha: number; color: number }) {
  return difference.alpha <= RASTER_ALPHA_TOLERANCE && difference.color <= RASTER_PREMULTIPLIED_TOLERANCE
}

/**
 * Aceita a saída da plataforma se ela casar estritamente com ao menos uma das precisões
 * de peso que o Chromium usa. Retorna a melhor diferença e qual precisão casou.
 */
export function rasterParityAnyPrecision<Variant extends string>(expected: ArrayLike<number>,
  candidates: readonly { variant: Variant; rgba: ArrayLike<number> }[], width: number, height: number,
  edges: readonly RasterSourceEdges[] = []) {
  let best: { variant: Variant; alpha: number; color: number; ignored: number } | undefined
  for (const candidate of candidates) {
    const difference = rasterParityDifference(expected, candidate.rgba, width, height, edges)
    const score = Math.max(difference.alpha - RASTER_ALPHA_TOLERANCE, difference.color - RASTER_PREMULTIPLIED_TOLERANCE)
    if (!best || score < Math.max(best.alpha - RASTER_ALPHA_TOLERANCE, best.color - RASTER_PREMULTIPLIED_TOLERANCE)) {
      best = { variant: candidate.variant, ...difference }
    }
  }
  if (!best) throw new Error('Nenhuma variante de precisão para comparar.')
  return best
}
