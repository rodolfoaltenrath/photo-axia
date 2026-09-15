<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import type { LayerStylePreset } from '../editor/layerStylePresets'

const props = defineProps<{
  busy: boolean
  layerName?: string
  open: boolean
  presets: LayerStylePreset[]
  targetCount: number
}>()
const emit = defineEmits<{
  (event: 'apply', id: string): void
  (event: 'cancel'): void
  (event: 'delete', id: string): void
  (event: 'rename', id: string, name: string): void
  (event: 'save', name: string): void
}>()

const name = ref('')
const input = ref<HTMLInputElement | null>(null)
const editingId = ref<string>()
const editingName = ref('')

function save() {
  if (name.value.trim()) emit('save', name.value)
}

function beginRename(preset: LayerStylePreset) {
  editingId.value = preset.id
  editingName.value = preset.name
}

function finishRename() {
  if (editingId.value && editingName.value.trim()) emit('rename', editingId.value, editingName.value)
  editingId.value = undefined
}

watch(() => props.open, async (open) => {
  if (!open) return
  name.value = ''
  editingId.value = undefined
  await nextTick()
  input.value?.focus()
})
</script>

<template>
  <div v-if="open" class="dialog-backdrop" role="presentation" @click.self="!busy && emit('cancel')">
    <section class="style-presets-dialog" aria-modal="true" role="dialog" aria-labelledby="style-presets-title" @keydown.esc.prevent="!busy && emit('cancel')">
      <header class="dialog-header">
        <div>
          <h2 id="style-presets-title">Estilos</h2>
          <span v-if="targetCount > 1">Ao aplicar, atualiza {{ targetCount }} camadas selecionadas</span>
          <span v-else>Reutilize efeitos em qualquer documento</span>
        </div>
        <button :disabled="busy" type="button" aria-label="Fechar" @click="emit('cancel')">×</button>
      </header>
      <div class="style-presets-save">
        <label><span>Salvar o estilo de “{{ layerName }}”</span><input ref="input" v-model="name" maxlength="80" placeholder="Nome do estilo" @keydown.enter.prevent="save" /></label>
        <button class="primary-button" :disabled="busy || !name.trim()" type="button" @click="save">Salvar como estilo</button>
      </div>
      <div class="style-presets-list" aria-live="polite">
        <p v-if="!presets.length">Nenhum estilo salvo ainda.</p>
        <article v-for="preset in presets" :key="preset.id" class="style-preset-card">
          <input v-if="editingId === preset.id" v-model="editingName" maxlength="80" aria-label="Novo nome do estilo" @blur="finishRename" @keydown.enter.prevent="finishRename" @keydown.esc.prevent="editingId = undefined" />
          <strong v-else>{{ preset.name }} <em v-if="preset.builtin">Axia</em></strong>
          <small>{{ preset.styles.effects.length }} efeito{{ preset.styles.effects.length === 1 ? '' : 's' }}</small>
          <div>
            <button :disabled="busy" type="button" @click="emit('apply', preset.id)">Aplicar</button>
            <button v-if="!preset.builtin" :disabled="busy" type="button" @click="beginRename(preset)">Renomear</button>
            <button v-if="!preset.builtin" class="layer-action--danger" :disabled="busy" type="button" @click="emit('delete', preset.id)">Excluir</button>
          </div>
        </article>
      </div>
      <footer class="dialog-actions"><button :disabled="busy" type="button" @click="emit('cancel')">Fechar</button></footer>
    </section>
  </div>
</template>
