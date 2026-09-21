import type { Ref } from 'vue'
import { hasDesktopBackend, selectDesktopPDF } from '../services/backend'
import type { PDFImportSource } from '../services/pdfImport'

interface PDFImportSelectionOptions {
  canOpenMediaDocument: (label: string) => Promise<boolean>
  errorText: Ref<string>
  isBusy: Ref<boolean>
  pdfFileInput: Ref<HTMLInputElement | null>
  pdfImportDestination: Ref<'document' | 'layer'>
  pdfImportSource: Ref<PDFImportSource | null>
  releasePDFSource: () => Promise<void>
  showError: (error: unknown, fallback: string) => void
  showImportPdfDialog: Ref<boolean>
  statusText: Ref<string>
}

/** Selects a PDF source and opens the existing page-selection dialog. */
export function usePDFImportSelection(options: PDFImportSelectionOptions) {
  async function beginPDFImport(destination: 'document' | 'layer') {
    if (options.isBusy.value || options.showImportPdfDialog.value) return
    if (destination === 'document' && !await options.canOpenMediaDocument('outro PDF')) return
    options.errorText.value = ''
    options.pdfImportDestination.value = destination
    if (!hasDesktopBackend()) {
      options.pdfFileInput.value?.click()
      return
    }
    options.isBusy.value = true
    options.statusText.value = 'Selecionando PDF…'
    try {
      const source = await selectDesktopPDF()
      if (!source) {
        options.statusText.value = destination === 'document' ? 'Abertura de PDF cancelada' : 'Importação de PDF cancelada'
        return
      }
      await options.releasePDFSource()
      options.pdfImportSource.value = source
      options.showImportPdfDialog.value = true
      options.statusText.value = destination === 'document' ? 'PDF pronto para abrir' : 'PDF pronto para adicionar'
    } catch (error) {
      options.showError(error, 'Não foi possível abrir o PDF.')
    } finally {
      options.isBusy.value = false
    }
  }

  return {
    beginPDFImport,
    importPDF: () => beginPDFImport('layer'),
    openPDFAsDocument: () => beginPDFImport('document')
  }
}
