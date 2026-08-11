import type { EditorGuide, RulerOrigin, RulerUnit } from '../editor/guides'
import type { DocumentSpec, ImageAsset, LayerItem, LayerTransform, TextLayerContent } from '../types/editor'

export const AXIA_PROJECT_VERSION = 1

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

interface AxiaStoredLayer extends Omit<LayerItem, 'image'> {
  image?: AxiaStoredImage
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
  return 'png'
}

function cloneTransform(transform?: LayerTransform) {
  return transform ? { ...transform } : undefined
}

function cloneText(text?: TextLayerContent) {
  return text ? { ...text } : undefined
}

export function createAxiaProjectManifest(state: AxiaProjectState) {
  const sourceAssets = new Map<string, AxiaArchiveAsset>()
  const assetSources: AxiaProjectAssetSource[] = []
  const layers: AxiaStoredLayer[] = state.layers.map((layer) => {
    const image = layer.image
    let storedImage: AxiaStoredImage | undefined
    if (image) {
      let asset = sourceAssets.get(image.sourceUrl)
      if (!asset) {
        const id = `asset-${String(sourceAssets.size + 1).padStart(4, '0')}`
        asset = {
          id,
          path: `assets/${id}.${extensionForMime(image.mimeType)}`,
          mimeType: image.mimeType,
          width: image.width,
          height: image.height,
          byteSize: image.byteSize,
          name: layer.name
        }
        sourceAssets.set(image.sourceUrl, asset)
        assetSources.push({ id, sourceUrl: image.sourceUrl })
      }
      storedImage = {
        assetId: asset.id,
        width: image.width,
        height: image.height,
        mimeType: image.mimeType,
        byteSize: image.byteSize
      }
    }
    return {
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      kind: layer.kind,
      image: storedImage,
      text: cloneText(layer.text),
      transform: cloneTransform(layer.transform)
    }
  })

  const manifest: AxiaProjectManifest = {
    format: 'axia',
    version: AXIA_PROJECT_VERSION,
    savedAt: new Date().toISOString(),
    document: { ...state.document },
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

export function restoreAxiaProject(manifestJSON: string, assetUrls: Record<string, string>): AxiaProjectState {
  const parsed = JSON.parse(manifestJSON) as Partial<AxiaProjectManifest>
  if (parsed.format !== 'axia' || parsed.version !== AXIA_PROJECT_VERSION) {
    throw new Error(`Versão de projeto .axia não suportada: ${String(parsed.version ?? 'desconhecida')}.`)
  }
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
  const layerKinds = new Set(['pixel', 'image', 'text', 'adjustment', 'background'])
  const layerIDs = new Set<string>()
  const layers: LayerItem[] = parsed.layers.map((stored) => {
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
        byteSize: archiveAsset.byteSize
      }
    }
    const transform = restoreTransform(stored.transform)
    const text = restoreText(stored.text)
    if (stored.kind === 'image' && (!image || !transform)) throw new Error('Camada de imagem incompleta.')
    if (stored.kind === 'text' && (!text || !transform)) throw new Error('Camada de texto incompleta.')
    const id = requireString(stored.id, 'ID da camada')
    if (layerIDs.has(id)) throw new Error(`Camada duplicada: ${id}.`)
    layerIDs.add(id)
    return {
      id,
      name: requireString(stored.name, 'Nome da camada'),
      visible: Boolean(stored.visible),
      opacity: Math.max(0, Math.min(100, stored.opacity)),
      kind: stored.kind,
      image,
      text,
      transform
    }
  })
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
    document: { ...document },
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
