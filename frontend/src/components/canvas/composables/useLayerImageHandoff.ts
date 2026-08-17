import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue'
import { releasePreparedImage } from '../../../services/imageImport'
import type { LayerItem, LayerTransform } from '../../../types/editor'
import type { LayerReadyWaiter } from '../canvas.types'

type ImageSlot = 0 | 1

interface LayerImageBufferOptions {
  active: () => boolean
  layer: () => LayerItem
  transform: () => LayerTransform
  layerRoot: Ref<HTMLElement | null>
  imageLoaded: (layerId: string, source: string) => void
  imageError: (layerId: string, source: string) => void
}

function copyTransform(transform: LayerTransform): LayerTransform {
  return {
    x: transform.x,
    y: transform.y,
    width: transform.width,
    height: transform.height,
    rotation: transform.rotation
  }
}

export function useLayerImageBuffer(options: LayerImageBufferOptions) {
  const desiredImageSource = computed(() => {
    const image = options.layer().image
    return image?.previewUrl ?? image?.sourceUrl ?? null
  })
  const initialTransform = copyTransform(options.transform())
  const imageSources = ref<[string | null, string | null]>([desiredImageSource.value, null])
  const imageReady = ref<[boolean, boolean]>([false, false])
  const imageTransforms = ref<[LayerTransform, LayerTransform]>([
    copyTransform(initialTransform),
    copyTransform(initialTransform)
  ])
  const activeImageSlot = ref<ImageSlot>(0)
  const activeImageTransform = ref(copyTransform(initialTransform))

  let releaseFrame = 0
  let compositorReadyFrame = 0
  let deferredActivation: { slot: ImageSlot; source: string } | undefined

  function releaseInactiveSlot(activeSlot: ImageSlot, source: string) {
    cancelAnimationFrame(releaseFrame)
    releaseFrame = requestAnimationFrame(() => {
      releaseFrame = 0
      if (activeImageSlot.value !== activeSlot || desiredImageSource.value !== source) return
      const inactiveSlot: ImageSlot = activeSlot === 0 ? 1 : 0
      if (!imageSources.value[inactiveSlot]) return
      const sources = [...imageSources.value] as [string | null, string | null]
      const readiness = [...imageReady.value] as [boolean, boolean]
      sources[inactiveSlot] = null
      readiness[inactiveSlot] = false
      imageSources.value = sources
      imageReady.value = readiness
    })
  }

  function activateImageSlot(slot: ImageSlot, source: string) {
    if (imageSources.value[slot] !== source || desiredImageSource.value !== source) return
    const layerRoot = options.layerRoot.value
    if (
      layerRoot?.classList.contains('document-layer--dragging') ||
      layerRoot?.classList.contains('document-layer--transforming')
    ) {
      deferredActivation = { slot, source }
      return
    }

    cancelAnimationFrame(compositorReadyFrame)
    const commitBuffer = () => {
      compositorReadyFrame = 0
      if (imageSources.value[slot] !== source || desiredImageSource.value !== source) return
      // Transformação e fonte mudam na mesma tarefa para o Vue publicar um só frame.
      activeImageTransform.value = copyTransform(imageTransforms.value[slot])
      activeImageSlot.value = slot
      options.imageLoaded(options.layer().id, source)
      releaseInactiveSlot(slot, source)
    }
    if (!options.active()) {
      commitBuffer()
      return
    }

    // O novo buffer permanece invisível por dois frames para o WebView preparar
    // sua textura; só então substitui atomicamente o raster ao vivo.
    compositorReadyFrame = requestAnimationFrame(() => {
      compositorReadyFrame = requestAnimationFrame(commitBuffer)
    })
  }

  function finishInteractiveTransform(event: Event) {
    const pending = deferredActivation
    deferredActivation = undefined
    if (!pending) return
    const transform = (event as CustomEvent<LayerTransform>).detail
    if (transform) {
      const transforms = [...imageTransforms.value] as [LayerTransform, LayerTransform]
      transforms[pending.slot] = copyTransform(transform)
      imageTransforms.value = transforms
    }
    activateImageSlot(pending.slot, pending.source)
  }

  async function handleImageLoad(slot: ImageSlot, event: Event) {
    const source = imageSources.value[slot]
    if (!source) return
    const image = event.currentTarget as HTMLImageElement
    try {
      await image.decode()
    } catch {
      if (!image.complete || image.naturalWidth === 0) return
    }
    if (imageSources.value[slot] !== source) return
    const readiness = [...imageReady.value] as [boolean, boolean]
    readiness[slot] = true
    imageReady.value = readiness
    if (source === desiredImageSource.value) activateImageSlot(slot, source)
  }

  function handleImageError(slot: ImageSlot) {
    const source = imageSources.value[slot]
    if (source && source === desiredImageSource.value) {
      options.imageError(options.layer().id, source)
    }
  }

  watch(desiredImageSource, (source) => {
    if (!source || imageSources.value[activeImageSlot.value] === source) return
    const targetSlot: ImageSlot = activeImageSlot.value === 0 ? 1 : 0
    const transforms = [...imageTransforms.value] as [LayerTransform, LayerTransform]
    transforms[targetSlot] = copyTransform(options.transform())
    imageTransforms.value = transforms
    if (imageSources.value[targetSlot] === source && imageReady.value[targetSlot]) {
      activateImageSlot(targetSlot, source)
      return
    }
    const sources = [...imageSources.value] as [string | null, string | null]
    const readiness = [...imageReady.value] as [boolean, boolean]
    sources[targetSlot] = source
    readiness[targetSlot] = false
    imageSources.value = sources
    imageReady.value = readiness
  })

  watch(
    () => {
      const transform = options.transform()
      return [transform.x, transform.y, transform.width, transform.height, transform.rotation]
    },
    () => {
      const desiredSource = desiredImageSource.value
      if (!desiredSource) return
      const matchingSlot = imageSources.value.findIndex((source) => source === desiredSource)
      if (matchingSlot < 0) return

      const slot = matchingSlot as ImageSlot
      const transform = copyTransform(options.transform())
      const transforms = [...imageTransforms.value] as [LayerTransform, LayerTransform]
      transforms[slot] = transform
      imageTransforms.value = transforms

      // Interações comuns continuam imediatas. Durante uma troca de raster,
      // somente o buffer invisível recebe a geometria nova.
      if (slot === activeImageSlot.value) activeImageTransform.value = transform
    }
  )

  onBeforeUnmount(() => {
    cancelAnimationFrame(releaseFrame)
    cancelAnimationFrame(compositorReadyFrame)
    deferredActivation = undefined
  })

  return {
    activeImageSlot,
    activeImageTransform,
    finishInteractiveTransform,
    handleImageError,
    handleImageLoad,
    imageSources
  }
}

interface LayerImageReadinessOptions {
  notifyImageLoaded: Array<(layerId: string, source: string) => void>
  notifyImageError: Array<(layerId: string, source: string) => void>
}

export function useLayerImageReadiness(options: LayerImageReadinessOptions) {
  const readyLayerSources = new Map<string, string>()
  const layerReadyWaiters = new Set<LayerReadyWaiter>()

  function markLayerImageReady(layerId: string, source: string) {
    readyLayerSources.set(layerId, source)
    for (const waiter of layerReadyWaiters) {
      if (waiter.remaining.get(layerId) !== source) continue
      waiter.remaining.delete(layerId)
      if (waiter.remaining.size) continue
      clearTimeout(waiter.timeout)
      layerReadyWaiters.delete(waiter)
      waiter.resolve()
    }
  }

  function handleLayerImageLoaded(layerId: string, source: string) {
    releasePreparedImage(source)
    markLayerImageReady(layerId, source)
    for (const notify of options.notifyImageLoaded) notify(layerId, source)
  }

  function handleLayerImageError(layerId: string, source: string) {
    releasePreparedImage(source)
    markLayerImageReady(layerId, source)
    for (const notify of options.notifyImageError) notify(layerId, source)
  }

  function waitForLayerImages(expected: Array<{ layerId: string; source: string }>, timeoutMs = 5000) {
    const remaining = new Map(
      expected
        .filter(({ layerId, source }) => readyLayerSources.get(layerId) !== source)
        .map(({ layerId, source }) => [layerId, source])
    )
    if (!remaining.size) return Promise.resolve()

    return new Promise<void>((resolve) => {
      const waiter: LayerReadyWaiter = {
        remaining,
        resolve,
        timeout: setTimeout(() => {
          layerReadyWaiters.delete(waiter)
          resolve()
        }, timeoutMs)
      }
      layerReadyWaiters.add(waiter)
    })
  }

  onBeforeUnmount(() => {
    for (const waiter of layerReadyWaiters) {
      clearTimeout(waiter.timeout)
      waiter.resolve()
    }
    layerReadyWaiters.clear()
    readyLayerSources.clear()
  })

  return {
    handleLayerImageError,
    handleLayerImageLoaded,
    waitForLayerImages
  }
}
