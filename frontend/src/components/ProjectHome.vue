<script setup lang="ts">
import RecentProjectCard from './RecentProjectCard.vue'
import type { RecentProject } from '../types/editor'
import axiaLogo from '../../../assets/Logo.png'

defineProps<{
  busy: boolean
  canReturnToEditor: boolean
  loading: boolean
  projects: RecentProject[]
}>()

const emit = defineEmits<{
  (event: 'clear'): void
  (event: 'newDocument'): void
  (event: 'openProject'): void
  (event: 'openRecent', path: string): void
  (event: 'removeRecent', path: string): void
  (event: 'returnToEditor'): void
}>()
</script>

<template>
  <main class="project-home">
    <header class="project-home-header">
      <img class="project-home-logo" :src="axiaLogo" alt="Axia Studio" />
      <div class="project-home-actions" aria-label="Ações de projeto">
        <button class="primary-button" :disabled="busy" type="button" @click="emit('newDocument')">
          Novo
        </button>
        <button :disabled="busy" type="button" @click="emit('openProject')">Abrir</button>
        <button v-if="canReturnToEditor" :disabled="busy" type="button" @click="emit('returnToEditor')">
          Voltar ao editor
        </button>
      </div>
    </header>

    <section class="recent-projects" :aria-busy="loading" aria-labelledby="recent-projects-title">
      <header class="recent-projects-header">
        <div>
          <p>Continue de onde parou</p>
          <h1 id="recent-projects-title">Projetos recentes</h1>
        </div>
        <button
          v-if="projects.length"
          class="quiet-button"
          :disabled="busy"
          type="button"
          @click="emit('clear')"
        >
          Limpar histórico
        </button>
      </header>

      <div v-if="loading" class="recent-project-grid" aria-live="polite" role="status">
        <span class="visually-hidden">Carregando projetos recentes</span>
        <div v-for="index in 6" :key="index" aria-hidden="true" class="recent-project-skeleton"></div>
      </div>

      <div v-else-if="projects.length" class="recent-project-grid">
        <RecentProjectCard
          v-for="project in projects"
          :key="project.id"
          :busy="busy"
          :project="project"
          @open="emit('openRecent', $event)"
          @remove="emit('removeRecent', $event)"
        />
      </div>

      <div v-else class="recent-projects-empty">
        <span aria-hidden="true">AX</span>
        <h2>Nenhum projeto recente</h2>
        <p>Crie um documento novo ou abra um projeto <code>.axia</code> existente.</p>
      </div>
    </section>
  </main>
</template>
