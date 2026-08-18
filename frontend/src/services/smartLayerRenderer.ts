import type { LayerItem, SmartLayerContent } from '../types/editor.ts'
import {
  cloneSmartLayerSource,
  smartLayerCacheKey,
  type SmartLayerRenderQuality
} from '../editor/smartLayers.ts'
import { ByteBudgetLruCache, LatestGenerationByKey } from '../editor/renderCache.ts'
import { releasePreparedImage } from './imageImport.ts'
import { renderSmartLayerContentBlob } from './renderDocument.ts'

export interface SmartLayerRenderRequest {
  consumerId: string
  content: SmartLayerContent
  width?: number
  height?: number
  quality?: SmartLayerRenderQuality
  renderer?: typeof renderSmartLayerContentBlob
}

export interface SmartLayerRenderResult {
  blob: Blob
  width: number
  height: number
  cacheKey: string
  fromCache: boolean
}

interface CachedSmartLayerRender extends Omit<SmartLayerRenderResult, 'fromCache'> {
  byteSize: number
  dispose: () => void
}

const cache = new ByteBudgetLruCache<CachedSmartLayerRender>(128 * 1024 * 1024, 48)
const generations = new LatestGenerationByKey()
const pendingByKey = new Map<string, Promise<CachedSmartLayerRender>>()
const cacheKeys = new Set<string>()
const contentGenerations = new Map<string, number>()
let cacheEpoch = 0

function publicResult(value: CachedSmartLayerRender, fromCache: boolean): SmartLayerRenderResult {
  return { blob: value.blob, width: value.width, height: value.height, cacheKey: value.cacheKey, fromCache }
}

function normalizedSize(value: number | undefined, fallback: number) {
  return Math.max(1, Math.min(16_384, Math.round(Number.isFinite(value) ? value! : fallback)))
}

async function materializeNestedSmartLayers(
  content: SmartLayerContent,
  quality: SmartLayerRenderQuality,
  parentKey: string
) {
  const temporarySources: string[] = []
  const dispose = () => {
    for (const source of temporarySources) {
      releasePreparedImage(source)
      URL.revokeObjectURL(source)
    }
  }
  const results = await Promise.allSettled(content.layers.map(async (source): Promise<LayerItem> => {
    const layer = cloneSmartLayerSource(source)
    if (!layer.smart) return layer
    const nested = await renderSmartLayer({
      consumerId: `${parentKey}:${layer.id}`,
      content: layer.smart,
      quality
    })
    const sourceUrl = URL.createObjectURL(nested.blob)
    temporarySources.push(sourceUrl)
    layer.image = {
      width: nested.width,
      height: nested.height,
      mimeType: 'image/png',
      sourceUrl,
      byteSize: nested.blob.size,
      editToken: nested.cacheKey
    }
    return layer
  }))
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed) {
    dispose()
    throw failed.reason
  }
  return {
    layers: results.map((result) => (result as PromiseFulfilledResult<LayerItem>).value),
    dispose
  }
}

async function executeRender(
  content: SmartLayerContent,
  width: number,
  height: number,
  quality: SmartLayerRenderQuality,
  key: string,
  renderer: typeof renderSmartLayerContentBlob
) {
  const materialized = await materializeNestedSmartLayers(content, quality, key)
  try {
    return await renderer(content, materialized.layers, width, height, quality === 'interactive')
  } finally {
    materialized.dispose()
  }
}

export async function renderSmartLayer(request: SmartLayerRenderRequest): Promise<SmartLayerRenderResult> {
  const quality = request.quality ?? 'final'
  const width = normalizedSize(request.width, request.content.width)
  const height = normalizedSize(request.height, request.content.height)
  if (width * height > 64_000_000) throw new Error('A camada inteligente excede o orçamento seguro de pixels.')
  const key = smartLayerCacheKey(request.content, width, height, quality)
  const generation = generations.begin(request.consumerId)
  const requestedContentGeneration = contentGenerations.get(request.content.id) ?? 0
  const cached = cache.get(key)
  if (cached) {
    if (!generation.isCurrent()) throw new Error('Renderização inteligente obsoleta.')
    return publicResult(cached, true)
  }

  let pending = pendingByKey.get(key)
  if (!pending) {
    const epoch = cacheEpoch
    const contentGeneration = requestedContentGeneration
    pending = executeRender(
      request.content,
      width,
      height,
      quality,
      key,
      request.renderer ?? renderSmartLayerContentBlob
    ).then((blob) => {
      const entry: CachedSmartLayerRender = {
        blob,
        width,
        height,
        cacheKey: key,
        byteSize: Math.max(blob.size, width * height * 4),
        dispose: () => cacheKeys.delete(key)
      }
      if (
        epoch === cacheEpoch &&
        (contentGenerations.get(request.content.id) ?? 0) === contentGeneration &&
        cache.set(key, entry)
      ) {
        cacheKeys.add(key)
      }
      return entry
    })
    pendingByKey.set(key, pending)
    void pending.finally(() => {
      if (pendingByKey.get(key) === pending) pendingByKey.delete(key)
    }).catch(() => undefined)
  }
  const result = await pending
  if (!generation.isCurrent() || (contentGenerations.get(request.content.id) ?? 0) !== requestedContentGeneration) {
    throw new Error('Renderização inteligente obsoleta.')
  }
  return publicResult(result, false)
}

export function seedSmartLayerRender(
  content: SmartLayerContent,
  blob: Blob,
  width = content.width,
  height = content.height,
  quality: SmartLayerRenderQuality = 'final'
) {
  const key = smartLayerCacheKey(content, width, height, quality)
  const entry: CachedSmartLayerRender = {
    blob,
    width,
    height,
    cacheKey: key,
    byteSize: Math.max(blob.size, width * height * 4),
    dispose: () => cacheKeys.delete(key)
  }
  if (cache.set(key, entry)) cacheKeys.add(key)
  return key
}

export function invalidateSmartLayerContent(contentId: string) {
  contentGenerations.set(contentId, (contentGenerations.get(contentId) ?? 0) + 1)
  for (const key of [...cacheKeys]) {
    if (key.startsWith(`${contentId}|`)) cache.delete(key)
  }
  for (const key of [...pendingByKey.keys()]) {
    if (key.startsWith(`${contentId}|`)) pendingByKey.delete(key)
  }
}

export function invalidateSmartLayerConsumer(consumerId: string) {
  generations.invalidate(consumerId)
}

export function clearSmartLayerRenderCache() {
  cacheEpoch++
  cache.clear()
  cacheKeys.clear()
  contentGenerations.clear()
  pendingByKey.clear()
  generations.clear()
}

export function smartLayerRenderCacheStats() {
  return { entries: cache.size, bytes: cache.sizeBytes, pending: pendingByKey.size }
}
