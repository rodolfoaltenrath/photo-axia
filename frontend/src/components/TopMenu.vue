<script setup lang="ts">
defineProps<{
  documentName: string
  statusText: string
}>()

const emit = defineEmits<{
  (event: 'newDocument'): void
  (event: 'importImages'): void
  (event: 'exportDocument'): void
  (event: 'previewFilter', filterName: string): void
}>()
</script>

<template>
  <header class="top-menu">
    <div class="brand">
      <span class="brand-mark">A</span>
      <strong>Axia</strong>
    </div>

    <nav class="menu-actions" aria-label="Acoes principais">
      <button type="button" @click="emit('newDocument')">Novo</button>
      <button type="button" @click="emit('importImages')">Importar</button>
      <button disabled title="Formato de projeto em breve" type="button">Salvar</button>
      <button disabled title="Filtros não destrutivos em breve" type="button">Filtro</button>
      <button type="button" @click="emit('exportDocument')">Exportar PNG</button>
    </nav>

    <div class="document-status">
      <strong>{{ documentName }}</strong>
      <span>{{ statusText }}</span>
    </div>
  </header>
</template>
