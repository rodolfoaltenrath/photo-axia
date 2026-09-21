import { openAxiaProject, openRecentProject } from './backend'
import { restoreAxiaProject } from './project'
import type { LayerItem } from '../types/editor'

/** Selects an Axia archive and restores its manifest without mutating editor state. */
export async function selectAndRestoreAxiaProject(recentPath = '') {
  const opened = recentPath ? await openRecentProject(recentPath) : await openAxiaProject()
  if (!opened.path) return null
  const assetUrls = Object.fromEntries(
    Object.entries(opened.assetUrls ?? {}).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
  )
  return { opened, restored: restoreAxiaProject(opened.manifest, assetUrls) }
}

export async function prepareRestoredProject(
  layers: LayerItem[],
  activeLayerId: string,
  prepareSmartLayer: (layer: LayerItem) => Promise<void>,
  preparePreview: (layer: LayerItem, prioritize: boolean) => Promise<void>,
  setStatus: (status: string) => void
) {
  const smartLayers = layers.filter((layer) => layer.kind === 'smart')
  for (const [index, layer] of smartLayers.entries()) {
    setStatus(smartLayers.length === 1 ? 'Renderizando camada inteligente…' : `Renderizando camada inteligente ${index + 1} de ${smartLayers.length}…`)
    await prepareSmartLayer(layer)
  }
  const imageLayers = layers.filter((layer) => layer.visible && layer.image && layer.transform)
  for (const [index, layer] of imageLayers.entries()) {
    setStatus(imageLayers.length === 1 ? 'Otimizando imagem do projeto…' : `Otimizando imagem ${index + 1} de ${imageLayers.length}…`)
    await preparePreview(layer, layer.id === activeLayerId)
  }
  return imageLayers
}

/** Runs the irreversible state swap only after the restored project is prepared. */
export async function applyPreparedProject(
  applySnapshot: () => void | Promise<void>,
  synchronizeViewport: () => Promise<void>
) {
  await applySnapshot()
  await synchronizeViewport()
}
