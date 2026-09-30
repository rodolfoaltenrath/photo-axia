<script setup lang="ts">
import RecentProjectCard from './RecentProjectCard.vue'
import { formatOfficialMessage, type OfficialLocale } from '../i18n/catalogs'
import type { RecentProject } from '../types/editor'
import axiaLogo from '../../../assets/Logo.png'

const props = withDefaults(defineProps<{
  busy: boolean
  canReturnToEditor: boolean
  loading: boolean
  projects: RecentProject[]
  locale?: OfficialLocale
}>(), { locale: 'pt-BR' })

const t = (key: Parameters<typeof formatOfficialMessage>[1]) => formatOfficialMessage(props.locale, key)

const emit = defineEmits<{
  (event: 'clear'): void
  (event: 'filesDropped', files: File[]): void
  (event: 'newDocument'): void
  (event: 'openImageDocument'): void
  (event: 'openPdfDocument'): void
  (event: 'openProject'): void
  (event: 'openRecent', path: string): void
  (event: 'removeRecent', path: string): void
  (event: 'returnToEditor'): void
}>()

function handleDrop(event: DragEvent) {
  event.preventDefault()
  if (!event.dataTransfer?.files.length) return
  emit('filesDropped', Array.from(event.dataTransfer.files))
}
</script>

<template>
  <main class="project-home" @dragover.prevent @drop="handleDrop">
    <header class="project-home-header">
      <img class="project-home-logo" :src="axiaLogo" alt="Axia Studio" />
      <div class="project-home-actions" :aria-label="t('home.actions.label')">
        <button class="primary-button" :disabled="busy" type="button" @click="emit('newDocument')">
          {{ t('home.actions.new') }}
        </button>
        <button :disabled="busy" type="button" @click="emit('openProject')">{{ t('home.actions.openProject') }}</button>
        <button :disabled="busy" type="button" @click="emit('openImageDocument')">{{ t('home.actions.openImage') }}</button>
        <button :disabled="busy" type="button" @click="emit('openPdfDocument')">{{ t('home.actions.openPdf') }}</button>
        <button v-if="canReturnToEditor" :disabled="busy" type="button" @click="emit('returnToEditor')">
          {{ t('home.actions.returnToEditor') }}
        </button>
      </div>
    </header>

    <section class="recent-projects" :aria-busy="loading" aria-labelledby="recent-projects-title">
      <header class="recent-projects-header">
        <div>
          <p>{{ t('home.recent.subtitle') }}</p>
          <h1 id="recent-projects-title">{{ t('home.recent.title') }}</h1>
        </div>
        <button
          v-if="projects.length"
          class="quiet-button"
          :disabled="busy"
          type="button"
          @click="emit('clear')"
        >
          {{ t('home.recent.clear') }}
        </button>
      </header>

      <div v-if="loading" class="recent-project-grid" aria-live="polite" role="status">
        <span class="visually-hidden">{{ t('home.recent.loading') }}</span>
        <div v-for="index in 6" :key="index" aria-hidden="true" class="recent-project-skeleton"></div>
      </div>

      <div v-else-if="projects.length" class="recent-project-grid">
        <RecentProjectCard
          v-for="project in projects"
          :key="project.id"
          :busy="busy"
          :locale="locale"
          :project="project"
          @open="emit('openRecent', $event)"
          @remove="emit('removeRecent', $event)"
        />
      </div>

      <div v-else class="recent-projects-empty">
        <span aria-hidden="true">AX</span>
        <h2>{{ t('home.recent.emptyTitle') }}</h2>
        <p>Crie um documento, abra um projeto <code>.axia</code> ou arraste uma imagem ou PDF para esta tela.</p>
      </div>
    </section>
  </main>
</template>
