<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { formatOfficialMessage, type OfficialLocale, type MessageKey, type MessageParams } from '../i18n/catalogs'
import type { RecentProject } from '../types/editor'

const props = withDefaults(defineProps<{
  busy: boolean
  project: RecentProject
  locale?: OfficialLocale
}>(), { locale: 'pt-BR' })

const t = (key: MessageKey, params?: MessageParams) => formatOfficialMessage(props.locale, key, params)

const emit = defineEmits<{
  (event: 'open', path: string): void
  (event: 'remove', path: string): void
}>()

const thumbnailFailed = ref(false)
watch(() => props.project.thumbnailUrl, () => { thumbnailFailed.value = false })

const modifiedLabel = computed(() => {
  if (!props.project.modifiedAt) return props.project.available ? t('recent.dateUnavailable') : t('recent.fileMissing')
  const date = new Date(props.project.modifiedAt)
  if (Number.isNaN(date.getTime())) return t('recent.dateUnavailable')
  return new Intl.DateTimeFormat(props.locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
})
</script>

<template>
  <article class="recent-project-card" :class="{ 'recent-project-card--missing': !project.available }">
    <button
      class="recent-project-open"
      :disabled="busy || !project.available"
      :title="project.available ? t('recent.open', { path: project.path }) : t('recent.fileMissingAtPath', { path: project.path })"
      type="button"
      @click="emit('open', project.path)"
    >
      <span class="recent-project-thumbnail">
        <img
          v-if="project.thumbnailUrl && !thumbnailFailed"
          :alt="t('recent.thumbnailAlt', { name: project.name })"
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
      :aria-label="t('recent.removeAria', { name: project.name })"
      :title="t('recent.removeTitle')"
      @click="emit('remove', project.path)"
    >
      ×
    </button>
  </article>
</template>
