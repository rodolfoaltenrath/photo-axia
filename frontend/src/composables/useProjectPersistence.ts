import type { Ref } from 'vue'
import { prepareAxiaProjectSave } from '../services/backend'
import { createAxiaProjectManifest, uploadAxiaProject } from '../services/project'
import { cloneLayerState } from '../editor/editorHistory'
import type { EditorGuide, RulerOrigin, RulerUnit } from '../editor/guides'
import type { DocumentSpec, LayerItem } from '../types/editor'

interface ProjectPersistenceOptions {
  activeDocument: Ref<DocumentSpec>
  activeLayerId: Ref<string>
  activeSmartLayerEdit: () => boolean
  commitPendingTransform: () => void
  errorText: Ref<string>
  finishSmartLayerEdit: () => Promise<boolean>
  guideSnappingEnabled: Ref<boolean>
  guides: Ref<EditorGuide[]>
  guidesLocked: Ref<boolean>
  guidesVisible: Ref<boolean>
  hasOpenDocument: Ref<boolean>
  historyRevision: Ref<number>
  isBusy: Ref<boolean>
  layers: Ref<LayerItem[]>
  projectPath: Ref<string>
  registerRecentProject: (path: string, document: DocumentSpec, layers: LayerItem[]) => Promise<void>
  rulerOrigin: Ref<RulerOrigin>
  rulerUnit: Ref<RulerUnit>
  savedHistoryRevision: Ref<number | null>
  settleRasterMutation: (status: string) => Promise<boolean>
  showError: (error: unknown, fallback: string) => void
  smartGuidesEnabled: Ref<boolean>
  statusText: Ref<string>
  zoom: Ref<number>
}

function projectNameFromPath(path: string, fallback: string) {
  const filename = path.split(/[\\/]/).at(-1)?.replace(/\.axia$/i, '').trim()
  return filename || fallback.replace(/\.axia$/i, '').trim() || 'Sem título'
}

/** Owns the .axia save transaction, including manifest construction and recents. */
export function useProjectPersistence(options: ProjectPersistenceOptions) {
  async function saveProject(saveAs = false): Promise<boolean> {
    if (options.activeSmartLayerEdit()) return options.finishSmartLayerEdit()
    if (options.isBusy.value || !options.hasOpenDocument.value) return false
    options.commitPendingTransform()
    if (!await options.settleRasterMutation('Finalizando edição antes de salvar…')) return false
    options.isBusy.value = true
    options.errorText.value = ''
    options.statusText.value = 'Preparando projeto Axia…'
    try {
      const target = await prepareAxiaProjectSave(
        options.activeDocument.value.name,
        options.projectPath.value,
        saveAs
      )
      if (!target.token || !target.path) {
        options.statusText.value = 'Salvamento cancelado'
        return false
      }
      const projectName = projectNameFromPath(target.path, options.activeDocument.value.name)
      const documentSnapshot = { ...options.activeDocument.value, name: projectName }
      const layerSnapshot = options.layers.value.map(cloneLayerState)
      const { manifest, assetSources } = createAxiaProjectManifest({
        document: documentSnapshot,
        layers: layerSnapshot,
        guides: options.guides.value,
        view: {
          activeLayerId: options.activeLayerId.value,
          guideSnappingEnabled: options.guideSnappingEnabled.value,
          smartGuidesEnabled: options.smartGuidesEnabled.value,
          guidesLocked: options.guidesLocked.value,
          guidesVisible: options.guidesVisible.value,
          rulerOrigin: options.rulerOrigin.value,
          rulerUnit: options.rulerUnit.value,
          zoom: options.zoom.value
        }
      })
      options.statusText.value = assetSources.length
        ? `Salvando projeto e ${assetSources.length} asset${assetSources.length === 1 ? '' : 's'}…`
        : 'Salvando projeto…'
      const saved = await uploadAxiaProject(target.token, manifest, assetSources)
      options.activeDocument.value = { ...options.activeDocument.value, name: projectName }
      options.projectPath.value = saved.path || target.path
      options.savedHistoryRevision.value = options.historyRevision.value
      options.statusText.value = `Projeto salvo: ${options.projectPath.value}`
      try {
        await options.registerRecentProject(options.projectPath.value, documentSnapshot, layerSnapshot)
      } catch {
        options.statusText.value = `Projeto salvo, mas o histórico recente não pôde ser atualizado: ${options.projectPath.value}`
      }
      return true
    } catch (error) {
      options.showError(error, 'Não foi possível salvar o projeto Axia.')
      return false
    } finally {
      options.isBusy.value = false
    }
  }

  return { saveProject }
}
