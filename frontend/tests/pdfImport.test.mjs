import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_PDF_PAGE_RASTER_BYTES,
  estimatePDFImportBytes,
  normalizePDFDPI,
  normalizePDFPages,
  pdfPagePixelSize,
  validatePDFImport
} from '../src/editor/pdfImport.ts'

const a4 = { pageNumber: 1, widthPoints: 595.28, heightPoints: 841.89 }

test('rasteriza uma página A4 nas dimensões esperadas para web e impressão', () => {
  assert.deepEqual(pdfPagePixelSize(a4, 150), { width: 1240, height: 1754 })
  assert.deepEqual(pdfPagePixelSize(a4, 300), { width: 2480, height: 3508 })
})

test('normaliza DPI e páginas repetidas ou fora do documento', () => {
  assert.equal(normalizePDFDPI(Number.NaN), 150)
  assert.equal(normalizePDFDPI(10), 36)
  assert.equal(normalizePDFDPI(900), 600)
  assert.deepEqual(normalizePDFPages([3, 1, 3, 0, 9, 2.8], 3), [1, 2, 3])
})

test('exige uma única página e bloqueia raster acima do limite de memória do PDF', () => {
  assert.match(validatePDFImport({ background: 'white', dpi: 150, pages: [] }, [a4]), /Escolha uma/)
  assert.equal(validatePDFImport({ background: 'white', dpi: 150, pages: [1] }, [a4]), '')
  assert.match(validatePDFImport({ background: 'white', dpi: 150, pages: [1, 2] }, [a4, { ...a4, pageNumber: 2 }]), /somente uma/)
  assert.ok(pdfPagePixelSize(a4, 300).width * pdfPagePixelSize(a4, 300).height * 4 < MAX_PDF_PAGE_RASTER_BYTES)
  const aboveMemoryLimit = { pageNumber: 1, widthPoints: 3_000, heightPoints: 1_000 }
  assert.match(validatePDFImport({ background: 'white', dpi: 150, pages: [1] }, [aboveMemoryLimit]), /mais de 48 MB/)
  const huge = { pageNumber: 1, widthPoints: 20_000, heightPoints: 20_000 }
  assert.match(validatePDFImport({ background: 'white', dpi: 600, pages: [1] }, [huge]), /16\.384|64 megapixels/)
})

test('estima o uso RGBA da página selecionada', () => {
  const size = pdfPagePixelSize(a4, 150)
  assert.equal(
    estimatePDFImportBytes({ background: 'transparent', dpi: 150, pages: [1] }, [a4]),
    size.width * size.height * 4
  )
})
