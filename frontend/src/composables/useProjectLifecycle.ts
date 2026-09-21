import type { ComputedRef, Ref } from 'vue'
import {
  clearRecentProjects,
  hasDesktopBackend,
  listRecentProjects,
  recordRecentProject,
  removeRecentProject,
  uploadRecentThumbnail
} from '../services/backend'
import { renderDocumentThumbnail } from '../services/renderDocument'
import { LatestPathTaskQueue, LatestRequestGate } from '../editor/recentTasks'
import type { DocumentSpec, LayerItem, RecentProject } from '../types/editor'

interface ProjectLifecycleOptions {
  appScreen: Ref<'home' | 'editor'>
  documentDirty: ComputedRef<boolean>
  hasActiveImagePlacement: () => boolean
  hasActiveSmartLayerEdit: () => boolean
  hasOpenDocument: Ref<boolean>
  isBusy: Ref<boolean>
  recentProjects: Ref<RecentProject[]>
  recentProjectsLoading: Ref<boolean>
  saveCurrentProject: () => Promise<boolean>
  showError: (error: unknown, fallback: string) => void
  showUnsavedChangesDialog: Ref<boolean>
  statusText: Ref<string>
}

/** Coordinates project-home UI, recents and the unsaved-changes decision. */
export function useProjectLifecycle(options: ProjectLifecycleOptions) {
  let discardChangesResolver: ((confirmed: boolean) => void) | undefined
  const recentRefreshGate = new LatestRequestGate()
  const thumbnailQueue = new LatestPathTaskQueue()

  function confirmDiscardChanges() {
    if (!options.documentDirty.value) return Promise.resolve(true)
    if (discardChangesResolver) return Promise.resolve(false)
    options.showUnsavedChangesDialog.value = true
    return new Promise<boolean>((resolve) => {
      discardChangesResolver = resolve
    })
  }

  function resolveDiscardChanges(confirmed: boolean) {
    options.showUnsavedChangesDialog.value = false
    const resolve = discardChangesResolver
    discardChangesResolver = undefined
    resolve?.(confirmed)
  }

  async function saveBeforeDiscarding() {
    const saved = await options.saveCurrentProject()
    resolveDiscardChanges(saved)
  }

  async function refreshRecentProjects(showLoading = true) {
    const request = recentRefreshGate.begin()
    if (showLoading) options.recentProjectsLoading.value = true
    try {
      const projects = await listRecentProjects()
      if (request.isCurrent()) options.recentProjects.value = projects
    } catch (error) {
      if (request.isCurrent()) options.showError(error, 'Não foi possível carregar os projetos recentes.')
    } finally {
      if (request.isCurrent()) options.recentProjectsLoading.value = false
    }
  }

  function queueProjectThumbnail(path: string, document: DocumentSpec, projectLayers: LayerItem[]) {
    if (!path || !hasDesktopBackend()) return
    void thumbnailQueue.enqueue(path, async (isLatest) => {
      try {
        const thumbnail = await renderDocumentThumbnail(document, projectLayers)
        if (!thumbnail || !isLatest()) return
        await uploadRecentThumbnail(path, thumbnail)
        if (!isLatest()) return
        await refreshRecentProjects(false)
      } catch {
        // A visual cache must never make a successful save fail.
      }
    })
  }

  async function registerRecentProject(
    path: string,
    document: DocumentSpec,
    projectLayers: LayerItem[],
    createThumbnail = true
  ) {
    if (!path || !hasDesktopBackend()) return
    await recordRecentProject(path, document.name, document.width, document.height)
    void refreshRecentProjects(false)
    if (createThumbnail) queueProjectThumbnail(path, document, projectLayers)
  }

  function showProjectHome() {
    if (options.isBusy.value) return
    if (options.hasActiveImagePlacement()) {
      options.statusText.value = 'Conclua ou cancele o posicionamento das imagens antes de sair.'
      return
    }
    if (options.hasActiveSmartLayerEdit()) {
      options.statusText.value = 'Conclua ou cancele a edição da camada inteligente antes de sair.'
      return
    }
    options.appScreen.value = 'home'
    void refreshRecentProjects()
  }

  function returnToEditor() {
    if (!options.hasOpenDocument.value || options.isBusy.value) return
    options.appScreen.value = 'editor'
  }

  async function removeProjectFromRecents(path: string) {
    if (options.isBusy.value) return
    try {
      await removeRecentProject(path)
      await refreshRecentProjects(false)
    } catch (error) {
      options.showError(error, 'Não foi possível remover o projeto dos recentes.')
    }
  }

  async function clearProjectRecents() {
    if (options.isBusy.value || !options.recentProjects.value.length) return
    if (!window.confirm('Limpar a lista de projetos recentes? Nenhum arquivo será apagado.')) return
    try {
      await clearRecentProjects()
      recentRefreshGate.invalidate()
      options.recentProjects.value = []
      options.recentProjectsLoading.value = false
    } catch (error) {
      options.showError(error, 'Não foi possível limpar os projetos recentes.')
    }
  }

  return {
    clearProjectRecents,
    confirmDiscardChanges,
    refreshRecentProjects,
    registerRecentProject,
    removeProjectFromRecents,
    resolveDiscardChanges,
    returnToEditor,
    saveBeforeDiscarding,
    showProjectHome
  }
}
