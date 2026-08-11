<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { RecentProject } from '../types/editor'

const props = defineProps<{
  busy: boolean
  project: RecentProject
}>()

const emit = defineEmits<{
  (event: 'open', path: string): void
  (event: 'remove', path: string): void
}>()

const thumbnailFailed = ref(false)
watch(() => props.project.thumbnailUrl, () => { thumbnailFailed.value = false })

const modifiedLabel = computed(() => {
  if (!props.project.modifiedAt) return props.project.available ? 'Data indisponível' : 'Arquivo não encontrado'
  const date = new Date(props.project.modifiedAt)
  if (Number.isNaN(date.getTime())) return 'Data indisponível'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
})
</script>

<template>
  <article class="recent-project-card" :class="{ 'recent-project-card--missing': !project.available }">
    <button
      class="recent-project-open"
      :disabled="busy || !project.available"
      :title="project.available ? `Abrir ${project.path}` : `Arquivo não encontrado: ${project.path}`"
      type="button"
      @click="emit('open', project.path)"
    >
      <span class="recent-project-thumbnail">
        <img
          v-if="project.thumbnailUrl && !thumbnailFailed"
          :alt="`Miniatura de ${project.name}`"
          decoding="async"
          loading="lazy"
          :src="project.thumbnailUrl"
          @error="thumbnailFailed = true"
        />
        <span v-else class="recent-project-placeholder" aria-hidden="true">
          {{ project.available ? 'AX' : '!' }}
        </span>
      </span>
      <span class="recent-project-copy">
        <strong>{{ project.name }}</strong>
        <span>{{ project.width }} × {{ project.height }} px</span>
        <span>{{ modifiedLabel }}</span>
      </span>
    </button>
    <button
      class="recent-project-remove"
      :disabled="busy"
      type="button"
      :aria-label="`Remover ${project.name} dos recentes`"
      title="Remover dos recentes (o arquivo não será apagado)"
      @click="emit('remove', project.path)"
    >
      ×
    </button>
  </article>
</template>
