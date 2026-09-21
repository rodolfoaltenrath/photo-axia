import type { Ref } from 'vue'
import { hasDesktopBackend, selectDesktopImage } from '../services/backend'
import { readBrowserImages } from '../services/imageImport'
import type { ImportedImage } from '../types/editor'

interface MediaDocumentOpenOptions {
  canOpenMediaDocument: (label: string) => Promise<boolean>
  documentImageInput: Ref<HTMLInputElement | null>
  errorText: Ref<string>
  isBusy: Ref<boolean>
  releaseUnadoptedImage: (image: ImportedImage | null | undefined) => void
  replaceDocumentWithImportedImage: (image: ImportedImage, name: string, label: string) => Promise<void>
  showError: (error: unknown, fallback: string) => void
  statusText: Ref<string>
}

/** Coordinates desktop and browser image selection for opening a media document. */
export function useMediaDocumentOpen(options: MediaDocumentOpenOptions) {
  async function openImageAsDocument() {
    if (!await options.canOpenMediaDocument('outra imagem')) return
    options.errorText.value = ''
    if (!hasDesktopBackend()) {
      options.documentImageInput.value?.click()
      return
    }
    options.isBusy.value = true
    options.statusText.value = 'Selecionando imagem…'
    let image: ImportedImage | null = null
    let adopted = false
    try {
      image = await selectDesktopImage()
      if (!image) {
        options.statusText.value = 'Abertura de imagem cancelada'
        return
      }
      options.statusText.value = 'Abrindo imagem como documento…'
      await options.replaceDocumentWithImportedImage(image, image.name, 'Imagem aberta')
      adopted = true
    } catch (error) {
      options.showError(error, 'Não foi possível abrir a imagem como documento.')
    } finally {
      if (!adopted) options.releaseUnadoptedImage(image)
      options.isBusy.value = false
    }
  }

  async function readLocalImageDocument(input: HTMLInputElement) {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    options.isBusy.value = true
    options.statusText.value = 'Abrindo imagem como documento…'
    let image: ImportedImage | undefined
    let adopted = false
    try {
      const result = await readBrowserImages([file])
      image = result.images[0]
      if (!image) throw new Error(result.errors[0] || 'A imagem não pôde ser lida.')
      await options.replaceDocumentWithImportedImage(image, image.name, 'Imagem aberta')
      adopted = true
      options.errorText.value = result.errors.join('\n')
    } catch (error) {
      options.showError(error, 'Não foi possível abrir a imagem como documento.')
    } finally {
      if (!adopted) options.releaseUnadoptedImage(image)
      options.isBusy.value = false
    }
  }

  return { openImageAsDocument, readLocalImageDocument }
}
