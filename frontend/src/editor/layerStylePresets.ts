import type { LayerEffect, LayerStyleConfig } from '../types/editor.ts'
import {
  cloneLayerStyleConfig,
  createDefaultLayerEffect,
  createLayerStyleConfig,
  layerStylePatternAssets,
  normalizeLayerStyleConfig,
  replaceLayerStylePatternAssets
} from './layerStyles.ts'

export interface LayerStylePreset {
  id: string
  name: string
  styles: LayerStyleConfig
  createdAt: number
  updatedAt: number
  builtin?: boolean
}

const DATABASE_NAME = 'axia-user-library'
const STORE_NAME = 'settings'
const LIBRARY_KEY = 'layer-style-presets-v1'
const MAX_PRESETS = 100
const MAX_PATTERN_BYTES = 8 * 1024 * 1024
const MAX_PRESET_ASSET_BYTES = 32 * 1024 * 1024

export function defaultLayerStylePresets(): LayerStylePreset[] {
  const shadow = createDefaultLayerEffect('drop-shadow', 'builtin-soft-shadow') as Extract<LayerEffect, { type: 'drop-shadow' }>
  shadow.opacity = 35
  shadow.distance = 8
  shadow.size = 16

  const stroke = createDefaultLayerEffect('stroke', 'builtin-dark-stroke') as Extract<LayerEffect, { type: 'stroke' }>
  stroke.size = 2
  stroke.position = 'inside'
  stroke.paint = { type: 'color', color: '#000000' }

  const glow = createDefaultLayerEffect('outer-glow', 'builtin-soft-glow') as Extract<LayerEffect, { type: 'outer-glow' }>
  glow.opacity = 60
  glow.size = 18
  glow.paint = { type: 'color', color: '#ffffff' }

  return [
    { id: 'builtin-soft-shadow', name: 'Sombra suave', styles: { ...createLayerStyleConfig(), effects: [shadow] }, createdAt: 0, updatedAt: 0, builtin: true },
    { id: 'builtin-dark-stroke', name: 'Contorno escuro', styles: { ...createLayerStyleConfig(), effects: [stroke] }, createdAt: 0, updatedAt: 0, builtin: true },
    { id: 'builtin-soft-glow', name: 'Brilho suave', styles: { ...createLayerStyleConfig(), effects: [glow] }, createdAt: 0, updatedAt: 0, builtin: true }
  ]
}

function cleanName(value: unknown) {
  return typeof value === 'string' ? value.trim().slice(0, 80) : ''
}

export function normalizeLayerStylePresets(value: unknown): LayerStylePreset[] {
  if (!Array.isArray(value)) return []
  const ids = new Set<string>()
  const result: LayerStylePreset[] = []
  for (const item of value.slice(0, MAX_PRESETS)) {
    if (!item || typeof item !== 'object') continue
    const source = item as Partial<LayerStylePreset>
    const id = typeof source.id === 'string' ? source.id.slice(0, 128) : ''
    const name = cleanName(source.name)
    if (!id || !name || ids.has(id)) continue
    ids.add(id)
    result.push({
      id,
      name,
      styles: normalizeLayerStyleConfig(source.styles),
      createdAt: Number.isFinite(source.createdAt) ? Number(source.createdAt) : Date.now(),
      updatedAt: Number.isFinite(source.updatedAt) ? Number(source.updatedAt) : Date.now()
    })
  }
  return result.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
}

function openDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir a biblioteca de estilos.'))
  })
}

async function storedLibrary(): Promise<LayerStylePreset[]> {
  const database = await openDatabase()
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME).objectStore(STORE_NAME).get(LIBRARY_KEY)
      request.onsuccess = () => resolve(normalizeLayerStylePresets(request.result))
      request.onerror = () => reject(request.error)
    })
  } finally {
    database.close()
  }
}

async function writeLibrary(presets: LayerStylePreset[]) {
  const database = await openDatabase()
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(presets, LIBRARY_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error ?? new Error('Não foi possível atualizar a biblioteca de estilos.'))
    })
  } finally {
    database.close()
  }
}

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

function approximateDataUrlBytes(sourceUrl: string) {
  const separator = sourceUrl.indexOf(',')
  if (separator < 0) return sourceUrl.length
  const payloadLength = sourceUrl.length - separator - 1
  return sourceUrl.slice(0, separator).includes(';base64')
    ? Math.floor(payloadLength * 3 / 4)
    : payloadLength
}

async function portableStyles(styles: LayerStyleConfig) {
  const replacements = new Map<string, string>()
  let totalBytes = 0
  for (const asset of layerStylePatternAssets(styles)) {
    if (asset.sourceUrl.startsWith('data:')) {
      if (replacements.has(asset.sourceUrl)) continue
      const byteSize = approximateDataUrlBytes(asset.sourceUrl)
      if (byteSize > MAX_PATTERN_BYTES) throw new Error(`O padrão “${asset.name}” excede o limite de 8 MB.`)
      totalBytes += byteSize
      replacements.set(asset.sourceUrl, asset.sourceUrl)
      if (totalBytes > MAX_PRESET_ASSET_BYTES) throw new Error('As texturas deste estilo excedem o limite total de 32 MB.')
      continue
    }
    if (replacements.has(asset.sourceUrl)) continue
    const response = await fetch(asset.sourceUrl)
    if (!response.ok) throw new Error(`Não foi possível incorporar “${asset.name}”.`)
    const blob = await response.blob()
    if (blob.size > MAX_PATTERN_BYTES) throw new Error(`O padrão “${asset.name}” excede o limite de 8 MB.`)
    totalBytes += blob.size
    if (totalBytes > MAX_PRESET_ASSET_BYTES) throw new Error('As texturas deste estilo excedem o limite total de 32 MB.')
    replacements.set(asset.sourceUrl, await blobDataUrl(blob))
  }
  return replaceLayerStylePatternAssets(styles, (asset) => ({
    ...asset,
    sourceUrl: replacements.get(asset.sourceUrl) ?? asset.sourceUrl
  }))
}

export async function listLayerStylePresets() {
  return [...defaultLayerStylePresets(), ...await storedLibrary()]
}

export async function saveLayerStylePreset(name: string, styles: LayerStyleConfig) {
  const clean = cleanName(name)
  if (!clean) throw new Error('Digite um nome para o estilo.')
  const presets = await storedLibrary()
  if (presets.length >= MAX_PRESETS) throw new Error('A biblioteca atingiu o limite de 100 estilos.')
  if ([...defaultLayerStylePresets(), ...presets].some((preset) => preset.name.localeCompare(clean, 'pt-BR', { sensitivity: 'accent' }) === 0)) {
    throw new Error('Já existe um estilo salvo com esse nome.')
  }
  const now = Date.now()
  presets.push({ id: crypto.randomUUID(), name: clean, styles: await portableStyles(styles), createdAt: now, updatedAt: now })
  await writeLibrary(normalizeLayerStylePresets(presets))
}

export async function renameLayerStylePreset(id: string, name: string) {
  if (id.startsWith('builtin-')) throw new Error('Os estilos incluídos no Axia não podem ser renomeados.')
  const clean = cleanName(name)
  if (!clean) throw new Error('Digite um nome para o estilo.')
  const presets = await storedLibrary()
  const preset = presets.find((item) => item.id === id)
  if (!preset) throw new Error('O estilo não está mais disponível.')
  if ([...defaultLayerStylePresets(), ...presets].some((item) => item.id !== id && item.name.localeCompare(clean, 'pt-BR', { sensitivity: 'accent' }) === 0)) {
    throw new Error('Já existe um estilo salvo com esse nome.')
  }
  preset.name = clean
  preset.updatedAt = Date.now()
  await writeLibrary(normalizeLayerStylePresets(presets))
}

export async function deleteLayerStylePreset(id: string) {
  if (id.startsWith('builtin-')) throw new Error('Os estilos incluídos no Axia não podem ser excluídos.')
  await writeLibrary((await storedLibrary()).filter((preset) => preset.id !== id))
}

export function presetStyles(preset: LayerStylePreset) {
  return cloneLayerStyleConfig(preset.styles)
}
