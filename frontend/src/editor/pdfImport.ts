import { MAX_DOCUMENT_DIMENSION, MAX_DOCUMENT_PIXELS } from './document.ts'

export const PDF_POINTS_PER_INCH = 72
export const MAX_PDF_PAGES = 250
export const MAX_PDF_PAGE_RASTER_BYTES = 48 * 1024 * 1024
export const PDF_IMPORT_DPI_OPTIONS = [96, 150, 300] as const

export type PDFImportBackground = 'white' | 'transparent'

export interface PDFPageSize {
  pageNumber: number
  widthPoints: number
  heightPoints: number
}

export interface PDFImportSettings {
  background: PDFImportBackground
  dpi: number
  pages: number[]
}

export function pdfPagePixelSize(page: Pick<PDFPageSize, 'widthPoints' | 'heightPoints'>, dpi: number) {
  const scale = normalizePDFDPI(dpi) / PDF_POINTS_PER_INCH
  return {
    width: Math.max(1, Math.round(page.widthPoints * scale)),
    height: Math.max(1, Math.round(page.heightPoints * scale))
  }
}

export function normalizePDFDPI(value: number) {
  if (!Number.isFinite(value)) return 150
  return Math.max(36, Math.min(600, Math.round(value)))
}

export function normalizePDFPages(pages: readonly number[], pageCount: number) {
  const maximum = Math.max(0, Math.min(MAX_PDF_PAGES, Math.floor(pageCount)))
  return [...new Set(pages.map(Math.floor))]
    .filter((page) => page >= 1 && page <= maximum)
    .sort((left, right) => left - right)
}

export function validatePDFImport(settings: PDFImportSettings, pageSizes: readonly PDFPageSize[]) {
  const pages = normalizePDFPages(settings.pages, pageSizes.length)
  if (!pages.length) return 'Escolha uma página.'
  if (pages.length > 1) return 'Importe somente uma página por vez.'
  const dpi = normalizePDFDPI(settings.dpi)
  for (const pageNumber of pages) {
    const page = pageSizes[pageNumber - 1]
    if (!page) return `A página ${pageNumber} não está disponível.`
    const pixels = pdfPagePixelSize(page, dpi)
    if (pixels.width > MAX_DOCUMENT_DIMENSION || pixels.height > MAX_DOCUMENT_DIMENSION) {
      return `A página ${pageNumber} ultrapassa 16.384 pixels em uma das dimensões nessa resolução.`
    }
    if (pixels.width * pixels.height > MAX_DOCUMENT_PIXELS) {
      return `A página ${pageNumber} ultrapassa o limite de 64 megapixels nessa resolução.`
    }
    if (pixels.width * pixels.height * 4 > MAX_PDF_PAGE_RASTER_BYTES) {
      return `A página ${pageNumber} usaria mais de 48 MB na memória nessa resolução. Escolha uma qualidade menor.`
    }
  }
  return ''
}

export function estimatePDFImportBytes(settings: PDFImportSettings, pageSizes: readonly PDFPageSize[]) {
  const dpi = normalizePDFDPI(settings.dpi)
  return normalizePDFPages(settings.pages, pageSizes.length).reduce((total, pageNumber) => {
    const page = pageSizes[pageNumber - 1]
    if (!page) return total
    const pixels = pdfPagePixelSize(page, dpi)
    return total + pixels.width * pixels.height * 4
  }, 0)
}
