import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist'
import pdfWorkerURL from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import {
  MAX_PDF_PAGES,
  normalizePDFDPI,
  pdfPagePixelSize,
  type PDFImportBackground,
  type PDFPageSize
} from '../editor/pdfImport.ts'
import type { ImportedImage } from '../types/editor.ts'

let pdfModulePromise: Promise<typeof import('pdfjs-dist')> | undefined

async function pdfModule() {
  pdfModulePromise ??= import('pdfjs-dist').then((module) => {
    module.GlobalWorkerOptions.workerSrc = pdfWorkerURL
    return module
  })
  return pdfModulePromise
}

export interface PDFImportSource {
  id: string
  name: string
  sourceUrl: string
  byteSize: number
}

export interface OpenedPDFImport {
  document: PDFDocumentProxy
  pages: PDFPageSize[]
}

export interface PDFRenderRequest {
  background: PDFImportBackground
  document: PDFDocumentProxy
  dpi: number
  name: string
  pages: number[]
  pageSizes: PDFPageSize[]
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Não foi possível criar a imagem da página.')),
      'image/png'
    )
  })
}

function cleanPDFName(name: string) {
  return name.replace(/\.pdf$/i, '').trim() || 'PDF'
}

function abortError() {
  return new DOMException('Importação cancelada.', 'AbortError')
}

export function isPDFPasswordError(error: unknown) {
  return error instanceof Error && error.name === 'PasswordException'
}

export function closePDFImport(document: PDFDocumentProxy) {
  return document.loadingTask.destroy()
}

export async function openPDFImport(sourceUrl: string, password = ''): Promise<OpenedPDFImport> {
  const { getDocument } = await pdfModule()
  const task = getDocument({ url: sourceUrl, password: password || undefined })
  let document: PDFDocumentProxy
  try {
    document = await task.promise
  } catch (error) {
    await task.destroy().catch(() => undefined)
    throw error
  }
  if (document.numPages > MAX_PDF_PAGES) {
    await closePDFImport(document)
    throw new Error(`O PDF possui ${document.numPages} páginas. O limite para abrir um documento é ${MAX_PDF_PAGES}.`)
  }
  const pages: PDFPageSize[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber)
    const viewport = page.getViewport({ scale: 1 })
    pages.push({ pageNumber, widthPoints: viewport.width, heightPoints: viewport.height })
    page.cleanup()
  }
  return { document, pages }
}

async function renderPageToCanvas(
  page: PDFPageProxy,
  width: number,
  height: number,
  scale: number,
  background: PDFImportBackground,
  signal?: AbortSignal
) {
  if (signal?.aborted) throw abortError()
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { alpha: background === 'transparent' })
  if (!context) throw new Error('O renderizador de páginas não está disponível.')
  if (background === 'white') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, width, height)
  }
  const renderTask = page.render({
    canvas,
    canvasContext: context,
    viewport: page.getViewport({ scale }),
    background: background === 'white' ? '#ffffff' : 'rgba(0,0,0,0)'
  })
  const cancel = () => renderTask.cancel()
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    try {
      await renderTask.promise
    } catch (error) {
      if (signal?.aborted) throw abortError()
      throw error
    }
    if (signal?.aborted) throw abortError()
    return canvas
  } finally {
    signal?.removeEventListener('abort', cancel)
  }
}

export async function renderPDFThumbnail(page: PDFPageProxy, maximumWidth = 168) {
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(1, maximumWidth / Math.max(1, base.width))
  const viewport = page.getViewport({ scale })
  const canvas = await renderPageToCanvas(
    page,
    Math.max(1, Math.ceil(viewport.width)),
    Math.max(1, Math.ceil(viewport.height)),
    scale,
    'white'
  )
  try {
    return URL.createObjectURL(await canvasBlob(canvas))
  } finally {
    canvas.width = 1
    canvas.height = 1
    page.cleanup()
  }
}

export async function renderPDFPages(
  request: PDFRenderRequest,
  signal: AbortSignal,
  onProgress?: (completed: number, total: number) => void
) {
  if (request.pages.length !== 1) {
    throw new Error('Escolha somente uma página do PDF por importação.')
  }
  const dpi = normalizePDFDPI(request.dpi)
  const images: ImportedImage[] = []
  const baseName = cleanPDFName(request.name)
  try {
    for (const [index, pageNumber] of request.pages.entries()) {
      if (signal.aborted) throw abortError()
      const descriptor = request.pageSizes[pageNumber - 1]
      if (!descriptor) throw new Error(`A página ${pageNumber} não está disponível.`)
      const size = pdfPagePixelSize(descriptor, dpi)
      const page = await request.document.getPage(pageNumber)
      const canvas = await renderPageToCanvas(
        page,
        size.width,
        size.height,
        dpi / 72,
        request.background,
        signal
      )
      try {
        const blob = await canvasBlob(canvas)
        images.push({
          id: crypto.randomUUID(),
          name: `${baseName} — página ${pageNumber}`,
          width: size.width,
          height: size.height,
          mimeType: 'image/png',
          sourceUrl: URL.createObjectURL(blob),
          byteSize: blob.size,
          resolutionDpiX: dpi,
          resolutionDpiY: dpi,
          resolutionSource: 'pdf-render'
        })
      } finally {
        canvas.width = 1
        canvas.height = 1
        page.cleanup()
      }
      onProgress?.(index + 1, request.pages.length)
    }
    return images
  } catch (error) {
    for (const image of images) URL.revokeObjectURL(image.sourceUrl)
    throw error
  }
}
