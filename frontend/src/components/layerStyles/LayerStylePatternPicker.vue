<script setup lang="ts">
import { ref } from 'vue'
import { createLayerStylePatternAssetFromFile, PatternAssetError } from '../../editor/patternAsset'
import type { LayerStylePatternAsset } from '../../types/editor'

defineProps<{ pattern?: LayerStylePatternAsset }>()

const emit = defineEmits<{
  (event: 'select', asset: LayerStylePatternAsset): void
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const errorMessage = ref('')

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  errorMessage.value = ''
  try {
    const asset = await createLayerStylePatternAssetFromFile(file)
    emit('select', asset)
  } catch (error) {
    errorMessage.value = error instanceof PatternAssetError
      ? error.message
      : 'Não foi possível carregar a imagem do padrão.'
  }
}
</script>

<template>
  <div class="layer-style-pattern-picker">
    <span
      class="layer-style-pattern-preview"
      :style="pattern ? { backgroundImage: `url(${pattern.sourceUrl})` } : undefined"
    >
      <span v-if="!pattern" aria-hidden="true">—</span>
    </span>
    <span class="layer-style-pattern-info">
      <span :title="pattern?.name">{{ pattern?.name ?? 'Nenhum padrão selecionado' }}</span>
      <button type="button" @click="fileInput?.click()">Escolher imagem…</button>
    </span>
    <input
      ref="fileInput"
      accept="image/png,image/jpeg,image/webp"
      hidden
      type="file"
      @change="handleFileChange"
    />
    <span v-if="errorMessage" class="layer-style-pattern-error" role="alert">{{ errorMessage }}</span>
  </div>
</template>
