import type { EditorGuide, RulerOrigin, RulerUnit } from '../editor/guides'
import type { DocumentSpec, ImageAsset, LayerItem, LayerStyleConfig, LayerStylePatternAsset, LayerTransform, SmartLayerContent, TextLayerContent } from '../types/editor'
import { normalizeLayerBlendMode } from '../editor/blendModes.ts'
import {
  cloneLayerStyleConfig,
  createLayerStyleConfig,
  normalizeLayerStyleConfig,
  normalizeLayerStyleGlobalLight
} from '../editor/layerStyles.ts'
import { SMART_LAYER_MAX_DEPTH } from '../editor/smartLayers.ts'

export const AXIA_PROJECT_VERSION = 2
export const AXIA_PROJECT_MAX_LAYERS = 10_000

export interface AxiaProjectViewState {
  activeLayerId: string
  guideSnappingEnabled: boolean
  guidesLocked: boolean
  guidesVisible: boolean
  rulerOrigin: RulerOrigin
  rulerUnit: RulerUnit
  zoom: number
}

export interface AxiaProjectState {
  document: DocumentSpec
  layers: LayerItem[]
  guides: EditorGuide[]
  view: AxiaProjectViewState
}

interface AxiaArchiveAsset {
  id: string
  path: string
  mimeType: string
  width: number
  height: number
  byteSize?: number
  name: string
}

interface AxiaStoredImage extends Omit<ImageAsset, 'sourceUrl' | 'previewUrl' | 'previewWidth' | 'previewHeight' | 'editToken'> {
  assetId: string
}

interface AxiaStoredSmartContent extends Omit<SmartLayerContent, 'layers'> {
  layers: AxiaStoredLayer[]
}

interface AxiaStoredLayer extends Omit<LayerItem, 'image' | 'smart' | 'styles'> {
  image?: AxiaStoredImage
  smart?: AxiaStoredSmartContent
  styles?: unknown
}

export interface AxiaProjectManifest {
  format: 'axia'
  version: number
  savedAt: string
  document: DocumentSpec
  layers: AxiaStoredLayer[]
  assets: AxiaArchiveAsset[]
  guides: EditorGuide[]
  view: AxiaProjectViewState
}

export interface AxiaProjectAssetSource {
  id: string
  sourceUrl: string
}

function extensionForMime(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg'
  if (mimeType === 'image/gif') return 'gif'
  if (mimeType === 'image/webp') return 'webp'
  return 'png'
}

function cloneTransform(transform?: LayerTransform) {
  return transform ? { ...transform } : undefined
}

function cloneText(text?: TextLayerContent) {
  return text ? { ...text } : undefined
}

function replaceStoredPatternReferences(
  styles: LayerStyleConfig,
  replacement: (value: unknown) => unknown
) {
  const cloned = cloneLayerStyleConfig(styles) as unknown as {
    enabled: boolean
    fillOpacity: number
    effects: Array<Record<string, unknown>>
  }
  for (const effect of cloned.effects) {
    if (effect.type === 'pattern-overlay' && effect.pattern) effect.pattern = replacement(effect.pattern)
    if (effect.type === 'stroke') {
      const paint = effect.paint as Record<string, unknown> | undefined
      if (paint?.type === 'pattern' && paint.pattern) paint.pattern = replacement(paint.pattern)
    }
    if (effect.type === 'bevel-emboss' && effect.texture) effect.texture = replacement(effect.texture)
  }
  return cloned
}

export function createAxiaProjectManifest(state: AxiaProjectState) {
  const sourceAssets = new Map<string, AxiaArchiveAsset>()
  const assetSources: AxiaProjectAssetSource[] = []
  const activeLayers = new WeakSet<LayerItem>()
  let layerCount = 0
  const registerAsset = (sourceUrl: string, asset: Omit<AxiaArchiveAsset, 'id' | 'path'>) => {
    let stored = sourceAssets.get(sourceUrl)
    if (!stored) {
      const id = `asset-${String(sourceAssets.size + 1).padStart(4, '0')}`
      stored = { ...asset, id, path: `assets/${id}.${extensionForMime(asset.mimeType)}` }
      sourceAssets.set(sourceUrl, stored)
      assetSources.push({ id, sourceUrl })
    }
    return stored
  }
  const storeLayer = (layer: LayerItem, depth: number): AxiaStoredLayer => {
    if (depth > SMART_LAYER_MAX_DEPTH) throw new Error('A camada inteligente excede o limite de aninhamento.')
    layerCount += 1
    if (layerCount > AXIA_PROJECT_MAX_LAYERS) throw new Error('O projeto excede o limite total de camadas.')
    if (activeLayers.has(layer)) throw new Error('O projeto contém uma estrutura cíclica de camadas.')
    activeLayers.add(layer)
    try {
      const image = layer.kind === 'smart' ? undefined : layer.image
      let storedImage: AxiaStoredImage | undefined
      if (image) {
        const asset = registerAsset(image.sourceUrl, {
          mimeType: image.mimeType,
          width: image.width,
          height: image.height,
          byteSize: image.byteSize,
          name: layer.name
        })
        storedImage = {
          assetId: asset.id,
          width: image.width,
          height: image.height,
          mimeType: image.mimeType,
          byteSize: image.byteSize
        }
      }
      const styles = normalizeLayerStyleConfig(layer.styles)
      const storedStyles = replaceStoredPatternReferences(styles, (value) => {
        const pattern = value as LayerStylePatternAsset
        const asset = registerAsset(pattern.sourceUrl, {
          mimeType: pattern.mimeType,
          width: pattern.width,
          height: pattern.height,
          byteSize: pattern.byteSize,
          name: pattern.name
        })
        const { sourceUrl: _sourceUrl, ...storedPattern } = pattern
        return { ...storedPattern, assetId: asset.id }
      })
      let smart: AxiaStoredSmartContent | undefined
      if (layer.kind === 'smart') {
        if (!layer.smart || !layer.smart.layers.length) throw new Error('Camada inteligente incompleta.')
        smart = {
          id: layer.smart.id,
          width: layer.smart.width,
          height: layer.smart.height,
          resolutionDpi: layer.smart.resolutionDpi,
          colorSpace: layer.smart.colorSpace,
          background: layer.smart.background,
          layerStyleGlobalLight: normalizeLayerStyleGlobalLight(layer.smart.layerStyleGlobalLight),
          layers: storeLayers(layer.smart.layers, depth + 1),
          revision: layer.smart.revision
        }
      }
      return {
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        blendMode: normalizeLayerBlendMode(layer.blendMode),
        kind: layer.kind,
        image: storedImage,
        smart,
        styles: storedStyles,
        text: cloneText(layer.text),
        transform: cloneTransform(layer.transform)
      }
    } finally {
      activeLayers.delete(layer)
    }
  }
  const storeLayers = (layers: readonly LayerItem[], depth: number): AxiaStoredLayer[] => {
    const layerIDs = new Set<string>()
    return layers.map((layer) => {
      if (layerIDs.has(layer.id)) throw new Error(`Camada duplicada: ${layer.id}.`)
      layerIDs.add(layer.id)
      return storeLayer(layer, depth)
    })
  }
  const layers = storeLayers(state.layers, 0)

  const manifest: AxiaProjectManifest = {
    format: 'axia',
    version: AXIA_PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    document: {
      ...state.document,
      layerStyleGlobalLight: normalizeLayerStyleGlobalLight(state.document.layerStyleGlobalLight)
    },
    layers,
    assets: [...sourceAssets.values()],
    guides: state.guides.map((guide) => ({ ...guide })),
    view: {
      ...state.view,
      rulerOrigin: { ...state.view.rulerOrigin }
    }
  }
  return { manifest, assetSources }
}

function finiteNumber(value: unknown, fallback?: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function requireString(value: unknown, label: string, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value)) throw new Error(`${label} inválido no projeto.`)
  return value
}

function restoreTransform(value: unknown): LayerTransform | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') throw new Error('Transformação de camada inválida.')
  const transform = value as Record<string, unknown>
  const x = finiteNumber(transform.x)
  const y = finiteNumber(transform.y)
  const width = finiteNumber(transform.width)
  const height = finiteNumber(transform.height)
  const rotation = finiteNumber(transform.rotation, 0)
  if (x === undefined || y === undefined || width === undefined || height === undefined || !width || !height) {
    throw new Error('Transformação de camada inválida.')
  }
  return { x, y, width, height, rotation }
}

function restoreText(value: unknown): TextLayerContent | undefined {
  if (value === undefined) return undefined
  if (!value || typeof value !== 'object') throw new Error('Camada de texto inválida.')
  const text = value as Record<string, unknown>
  const fontSize = finiteNumber(text.fontSize)
  const fontWeight = finiteNumber(text.fontWeight)
  const lineHeight = finiteNumber(text.lineHeight)
  const baseWidth = finiteNumber(text.baseWidth)
  const baseHeight = finiteNumber(text.baseHeight)
  if (!fontSize || !fontWeight || !lineHeight || !baseWidth || !baseHeight) throw new Error('Camada de texto inválida.')
  const alignment = text.alignment
  if (alignment !== 'left' && alignment !== 'center' && alignment !== 'right') throw new Error('Alinhamento de texto inválido.')
  return {
    content: requireString(text.content, 'Conteúdo de texto', true),
    fontFamily: requireString(text.fontFamily, 'Fonte'),
    fontSize,
    fontWeight,
    color: requireString(text.color, 'Cor'),
    alignment,
    lineHeight,
    baseWidth,
    baseHeight
  }
}

function restoreLayerStyles(
  value: unknown,
  assets: Map<string, AxiaArchiveAsset>,
  assetUrls: Record<string, string>
) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return createLayerStyleConfig()
  const source = value as Record<string, unknown>
  const hydratePattern = (patternValue: unknown) => {
    if (!patternValue || typeof patternValue !== 'object' || Array.isArray(patternValue)) return undefined
    const storedPattern = patternValue as Record<string, unknown>
    if (typeof storedPattern.assetId !== 'string') return undefined
    const archiveAsset = assets.get(storedPattern.assetId)
    const sourceUrl = assetUrls[storedPattern.assetId]
    if (!archiveAsset || !sourceUrl) throw new Error(`Asset de padrão ausente: ${storedPattern.assetId}.`)
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(archiveAsset.mimeType)) {
      throw new Error(`Formato de padrão não suportado: ${archiveAsset.mimeType}.`)
    }
    if (
      !Number.isFinite(archiveAsset.width) || !Number.isFinite(archiveAsset.height) ||
      archiveAsset.width <= 0 || archiveAsset.height <= 0 ||
      archiveAsset.width > 8_192 || archiveAsset.height > 8_192 ||
      archiveAsset.width * archiveAsset.height > 16_777_216
    ) throw new Error('Dimensões de padrão inválidas.')
    return {
      ...storedPattern,
      width: archiveAsset.width,
      height: archiveAsset.height,
      mimeType: archiveAsset.mimeType,
      byteSize: archiveAsset.byteSize,
      sourceUrl
    }
  }
  const effects = Array.isArray(source.effects) ? source.effects.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const effect = { ...(value as Record<string, unknown>) }
    if (effect.type === 'pattern-overlay') effect.pattern = hydratePattern(effect.pattern)
    if (effect.type === 'stroke' && effect.paint && typeof effect.paint === 'object' && !Array.isArray(effect.paint)) {
      const paint = { ...(effect.paint as Record<string, unknown>) }
      if (paint.type === 'pattern') paint.pattern = hydratePattern(paint.pattern)
      effect.paint = paint
    }
    if (effect.type === 'bevel-emboss') effect.texture = hydratePattern(effect.texture)
    return effect
  }) : []
  return normalizeLayerStyleConfig({ ...source, effects })
}

export function restoreAxiaProject(manifestJSON: string, assetUrls: Record<string, string>): AxiaProjectState {
  const parsed = JSON.parse(manifestJSON) as Partial<AxiaProjectManifest>
  if (parsed.format !== 'axia' || (parsed.version !== 1 && parsed.version !== AXIA_PROJECT_VERSION)) {
    throw new Error(`Versão de projeto .axia não suportada: ${String(parsed.version ?? 'desconhecida')}.`)
  }
  const projectVersion = parsed.version
  const document = parsed.document
  if (
    !document || !Number.isFinite(document.width) || !Number.isFinite(document.height) ||
    document.width <= 0 || document.height <= 0 || document.width > 16_384 || document.height > 16_384 ||
    document.width * document.height > 64_000_000
  ) {
    throw new Error('Dimensões do documento inválidas.')
  }
  if (
    !new Set(['px', 'cm', 'mm', 'in']).has(document.unit) ||
    (document.background !== 'transparent' && document.background !== 'white' && document.background !== 'black') ||
    !Number.isFinite(document.resolutionDpi) || document.resolutionDpi <= 0
  ) throw new Error('Configurações do documento inválidas.')
  requireString(document.id, 'ID do documento')
  requireString(document.name, 'Nome do documento')
  if (!Array.isArray(parsed.layers) || !parsed.layers.length || !Array.isArray(parsed.assets)) {
    throw new Error('Estrutura de camadas inválida.')
  }
  const assets = new Map(parsed.assets.map((asset) => [asset.id, asset]))
  const layerKinds = new Set(['pixel', 'image', 'text', 'smart', 'adjustment', 'background'])
  let layerCount = 0
  const restoreStoredLayers = (storedLayers: AxiaStoredLayer[], depth: number): LayerItem[] => {
    if (depth > SMART_LAYER_MAX_DEPTH) throw new Error('A camada inteligente excede o limite de aninhamento.')
    const layerIDs = new Set<string>()
    return storedLayers.map((stored) => {
    layerCount += 1
    if (layerCount > AXIA_PROJECT_MAX_LAYERS) throw new Error('O projeto excede o limite total de camadas.')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) throw new Error('Camada inválida no projeto.')
    if (!layerKinds.has(stored.kind) || !Number.isFinite(stored.opacity)) throw new Error('Camada inválida no projeto.')
    let image: ImageAsset | undefined
    if (stored.image) {
      const archiveAsset = assets.get(stored.image.assetId)
      const sourceUrl = assetUrls[stored.image.assetId]
      if (!archiveAsset || !sourceUrl) throw new Error(`Asset ausente: ${stored.image.assetId}.`)
      image = {
        width: archiveAsset.width,
        height: archiveAsset.height,
        mimeType: archiveAsset.mimeType,
        sourceUrl,
        byteSize: archiveAsset.byteSize,
        resolutionDpiX: Number.isFinite(stored.image.resolutionDpiX) ? stored.image.resolutionDpiX : undefined,
        resolutionDpiY: Number.isFinite(stored.image.resolutionDpiY) ? stored.image.resolutionDpiY : undefined,
        resolutionSource: ['png-phys', 'jpeg-jfif', 'jpeg-exif'].includes(stored.image.resolutionSource ?? '')
          ? stored.image.resolutionSource
          : undefined
      }
    }
    const transform = restoreTransform(stored.transform)
    const text = restoreText(stored.text)
    const styles = restoreLayerStyles(stored.styles, assets, assetUrls)
    if (stored.kind === 'image' && (!image || !transform)) throw new Error('Camada de imagem incompleta.')
    if (stored.kind === 'text' && (!text || !transform)) throw new Error('Camada de texto incompleta.')
    let smart: SmartLayerContent | undefined
    if (stored.kind === 'smart') {
      const source = stored.smart
      if (
        projectVersion < 2 || !source || !Array.isArray(source.layers) || !source.layers.length ||
        typeof source.id !== 'string' || !source.id ||
        !Number.isFinite(source.width) || !Number.isFinite(source.height) ||
        source.width <= 0 || source.height <= 0 || source.width > 16_384 || source.height > 16_384 ||
        source.width * source.height > 64_000_000 ||
        !Number.isFinite(source.resolutionDpi) || source.resolutionDpi <= 0 ||
        !Number.isFinite(source.revision) || source.revision < 1 ||
        !['transparent', 'white', 'black'].includes(source.background)
      ) throw new Error('Conteúdo de camada inteligente inválido.')
      smart = {
        id: source.id,
        width: source.width,
        height: source.height,
        resolutionDpi: source.resolutionDpi,
        colorSpace: requireString(source.colorSpace, 'Espaço de cor da camada inteligente'),
        background: source.background,
        layerStyleGlobalLight: normalizeLayerStyleGlobalLight(source.layerStyleGlobalLight),
        layers: restoreStoredLayers(source.layers, depth + 1),
        revision: Math.floor(source.revision)
      }
      if (!transform) throw new Error('Camada inteligente incompleta.')
    } else if (stored.smart) {
      throw new Error('Conteúdo inteligente associado a um tipo de camada inválido.')
    }
    const id = requireString(stored.id, 'ID da camada')
    if (layerIDs.has(id)) throw new Error(`Camada duplicada: ${id}.`)
    layerIDs.add(id)
    return {
      id,
      name: requireString(stored.name, 'Nome da camada'),
      visible: Boolean(stored.visible),
      opacity: Math.max(0, Math.min(100, stored.opacity)),
      blendMode: normalizeLayerBlendMode(stored.blendMode),
      kind: stored.kind,
      styles,
      image,
      smart,
      text,
      transform
    }
    })
  }
  const layers = restoreStoredLayers(parsed.layers, 0)
  const view = parsed.view
  const activeLayerId = view?.activeLayerId && layers.some((layer) => layer.id === view.activeLayerId)
    ? view.activeLayerId
    : layers[0]!.id
  const rulerUnits = new Set<RulerUnit>(['px', 'cm', 'mm', 'in'])
  const rulerUnit = view?.rulerUnit && rulerUnits.has(view.rulerUnit) ? view.rulerUnit : 'px'
  const originX = finiteNumber(view?.rulerOrigin?.x, 0)!
  const originY = finiteNumber(view?.rulerOrigin?.y, 0)!
  const guideIDs = new Set<string>()
  const guides = Array.isArray(parsed.guides)
    ? parsed.guides.filter((guide) => {
        const valid =
        typeof guide?.id === 'string' &&
        (guide.orientation === 'horizontal' || guide.orientation === 'vertical') &&
        Number.isFinite(guide.position)
        if (!valid || guideIDs.has(guide.id)) return false
        guideIDs.add(guide.id)
        return true
      }).map((guide) => ({ ...guide }))
    : []
  return {
    document: {
      ...document,
      layerStyleGlobalLight: normalizeLayerStyleGlobalLight(document.layerStyleGlobalLight)
    },
    layers,
    guides,
    view: {
      activeLayerId,
      guideSnappingEnabled: view?.guideSnappingEnabled !== false,
      guidesLocked: view?.guidesLocked === true,
      guidesVisible: view?.guidesVisible !== false,
      rulerOrigin: { x: originX, y: originY },
      rulerUnit,
      zoom: Math.max(5, Math.min(3200, finiteNumber(view?.zoom, 100)!))
    }
  }
}

export async function uploadAxiaProject(
  token: string,
  manifest: AxiaProjectManifest,
  assetSources: AxiaProjectAssetSource[]
) {
  const form = new FormData()
  form.append('manifest', JSON.stringify(manifest))
  const nativeAssets: Record<string, string> = {}
  for (const asset of assetSources) {
    if (asset.sourceUrl.startsWith('/__axia_asset/')) {
      nativeAssets[asset.id] = asset.sourceUrl
      continue
    }
    const response = await fetch(asset.sourceUrl)
    if (!response.ok) throw new Error(`Não foi possível ler o asset ${asset.id}.`)
    form.append(`asset__${asset.id}`, await response.blob(), asset.id)
  }
  form.append('nativeAssets', JSON.stringify(nativeAssets))
  const response = await fetch(`/__axia_project/save/${encodeURIComponent(token)}`, {
    method: 'POST',
    body: form
  })
  if (!response.ok) throw new Error((await response.text()).trim() || 'Não foi possível salvar o projeto.')
  return (await response.json()) as { path: string }
}
