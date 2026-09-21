import type { Ref } from 'vue'
import { hasDesktopBackend, selectDesktopImages } from '../services/backend'
import { readBrowserImages } from '../services/imageImport'
import type { ImportedImage } from '../types/editor'

interface LayerImageImportOptions {
  errorText: Ref<string>
  fileInput: Ref<HTMLInputElement | null>
  isBusy: Ref<boolean>
  showError: (error: unknown, fallback: string) => void
  startImagePlacementQueue: (images: ImportedImage[], errors?: string[]) => Promise<void>
  statusText: Ref<string>
}

/** Selects image files and forwards them to the existing placement queue. */
export function useLayerImageImport(options: LayerImageImportOptions) {
  async function importImages() {
    options.errorText.value = ''
    if (!hasDesktopBackend()) {
      options.fileInput.value?.click()
      return
    }
    options.isBusy.value = true
    options.statusText.value = 'Selecionando imagens…'
    try {
      await options.startImagePlacementQueue(await selectDesktopImages())
    } catch (error) {
      options.showError(error, 'Não foi possível importar as imagens.')
    } finally {
      options.isBusy.value = false
    }
  }

  async function readLocalFiles(input: HTMLInputElement) {
    if (!input.files?.length) return
    options.isBusy.value = true
    options.statusText.value = 'Preparando imagens para posicionamento…'
    try {
      const result = await readBrowserImages(input.files)
      await options.startImagePlacementQueue(result.images, result.errors)
    } catch (error) {
      options.showError(error, 'Não foi possível importar as imagens.')
    } finally {
      input.value = ''
      options.isBusy.value = false
    }
  }

  return { importImages, readLocalFiles }
}
