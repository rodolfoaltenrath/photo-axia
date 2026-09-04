<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import LayerStyleColorOverlayControls from './layerStyles/LayerStyleColorOverlayControls.vue'
import LayerStyleBevelEmbossControls from './layerStyles/LayerStyleBevelEmbossControls.vue'
import LayerStyleGradientOverlayControls from './layerStyles/LayerStyleGradientOverlayControls.vue'
import LayerStylePatternOverlayControls from './layerStyles/LayerStylePatternOverlayControls.vue'
import LayerStylePatternPicker from './layerStyles/LayerStylePatternPicker.vue'
import LayerStyleSatinControls from './layerStyles/LayerStyleSatinControls.vue'
import {
  centerFloatingWindow,
  fitFloatingWindow,
  moveFloatingWindow,
  resizeFloatingWindow,
  type FloatingWindowCorner,
  type FloatingWindowRect
} from '../editor/floatingWindow'
import {
  cloneLayerStyleConfig,
  createDefaultLayerEffect,
  layerStylePatternAssets,
  normalizeLayerEffect,
  normalizeLayerStyleFillOpacity,
  normalizeLayerStyleGlobalLight
} from '../editor/layerStyles'
import type {
  BevelEmbossEffect,
  ColorOverlayEffect,
  DropShadowEffect,
  GradientOverlayEffect,
  InnerGlowEffect,
  InnerShadowEffect,
  LayerStyleConfig,
  LayerStyleGlobalLight,
  LayerStyleGradient,
  LayerStylePatternAsset,
  OuterGlowEffect,
  PatternOverlayEffect,
  SatinEffect,
  StrokeEffect
} from '../types/editor'

const props = defineProps<{
  globalLight: LayerStyleGlobalLight
  layerName: string
  open: boolean
  rasterEffectsAvailable: boolean
  styles: LayerStyleConfig
}>()

const emit = defineEmits<{
  (event: 'apply', styles: LayerStyleConfig, globalLight: LayerStyleGlobalLight): void
  (event: 'cancel'): void
  (event: 'preview', styles: LayerStyleConfig, globalLight: LayerStyleGlobalLight): void
}>()

const dialog = ref<HTMLElement | null>(null)
const initialFocus = ref<HTMLButtonElement | null>(null)
const draft = shallowRef(cloneLayerStyleConfig(props.styles))
const draftGlobalLight = shallowRef(normalizeLayerStyleGlobalLight(props.globalLight))
const outerGlowSettings = shallowRef(createDefaultLayerEffect('outer-glow') as OuterGlowEffect)
const innerGlowSettings = shallowRef(createDefaultLayerEffect('inner-glow') as InnerGlowEffect)
const dropShadowSettings = shallowRef(createDefaultLayerEffect('drop-shadow') as DropShadowEffect)
const innerShadowSettings = shallowRef(createDefaultLayerEffect('inner-shadow') as InnerShadowEffect)
const strokeSettings = shallowRef(createDefaultLayerEffect('stroke') as StrokeEffect)
const colorOverlaySettings = shallowRef(createDefaultLayerEffect('color-overlay') as ColorOverlayEffect)
const gradientOverlaySettings = shallowRef(createDefaultLayerEffect('gradient-overlay') as GradientOverlayEffect)
const patternOverlaySettings = shallowRef(createDefaultLayerEffect('pattern-overlay') as PatternOverlayEffect)
const satinSettings = shallowRef(createDefaultLayerEffect('satin') as SatinEffect)
const bevelEmbossSettings = shallowRef(createDefaultLayerEffect('bevel-emboss') as BevelEmbossEffect)
const selectedCategory = ref<'blending' | 'drop-shadow' | 'inner-shadow' | 'outer-glow' | 'inner-glow' | 'stroke' | 'color-overlay' | 'gradient-overlay' | 'pattern-overlay' | 'satin' | 'bevel-emboss'>('blending')
const previewEnabled = ref(true)
let outerGlowOriginallyPresent = false
let innerGlowOriginallyPresent = false
let dropShadowOriginallyPresent = false
let innerShadowOriginallyPresent = false
let strokeOriginallyPresent = false
let colorOverlayOriginallyPresent = false
let gradientOverlayOriginallyPresent = false
let patternOverlayOriginallyPresent = false
let satinOriginallyPresent = false
let bevelEmbossOriginallyPresent = false
const sessionPatternUrls = new Set<string>()

const DEFAULT_DIALOG_SIZE = { width: 680, height: 580 }
const MINIMUM_DIALOG_SIZE = { width: 560, height: 420 }
const dialogRect = shallowRef<FloatingWindowRect>({ left: 0, top: 0, ...DEFAULT_DIALOG_SIZE })
let dialogPositioned = false
let pointerInteraction: {
  corner?: FloatingWindowCorner
  kind: 'move' | 'resize'
  pointerId: number
  startClientX: number
  startClientY: number
  startRect: FloatingWindowRect
  target: HTMLElement
} | undefined
let previousBodyCursor = ''
let previousBodyUserSelect = ''

const dialogStyle = computed(() => ({
  height: `${dialogRect.value.height}px`,
  left: `${dialogRect.value.left}px`,
  top: `${dialogRect.value.top}px`,
  width: `${dialogRect.value.width}px`
}))

const outerGlow = computed(() => draft.value.effects.find(
  (effect): effect is OuterGlowEffect => effect.type === 'outer-glow'
))
const outerGlowActive = computed(() => Boolean(outerGlow.value?.enabled))
const outerGlowColor = computed(() => {
  const paint = outerGlowSettings.value.paint
  return paint.type === 'color' ? paint.color : paint.gradient.colorStops[0]?.color ?? '#ffffbe'
})
const outerGlowGradientEnd = computed(() => {
  const paint = outerGlowSettings.value.paint
  return paint.type === 'gradient' ? paint.gradient.colorStops.at(-1)?.color ?? '#ffffff' : '#ffffff'
})
const innerGlow = computed(() => draft.value.effects.find(
  (effect): effect is InnerGlowEffect => effect.type === 'inner-glow'
))
const innerGlowActive = computed(() => Boolean(innerGlow.value?.enabled))
const innerGlowColor = computed(() => {
  const paint = innerGlowSettings.value.paint
  return paint.type === 'color' ? paint.color : paint.gradient.colorStops[0]?.color ?? '#ffffbe'
})
const innerGlowGradientEnd = computed(() => {
  const paint = innerGlowSettings.value.paint
  return paint.type === 'gradient' ? paint.gradient.colorStops.at(-1)?.color ?? '#ffffff' : '#ffffff'
})
const dropShadow = computed(() => draft.value.effects.find(
  (effect): effect is DropShadowEffect => effect.type === 'drop-shadow'
))
const dropShadowActive = computed(() => Boolean(dropShadow.value?.enabled))
const dropShadowAngle = computed(() => dropShadowSettings.value.useGlobalLight
  ? draftGlobalLight.value.angle
  : dropShadowSettings.value.angle)
const innerShadow = computed(() => draft.value.effects.find(
  (effect): effect is InnerShadowEffect => effect.type === 'inner-shadow'
))
const innerShadowActive = computed(() => Boolean(innerShadow.value?.enabled))
const innerShadowAngle = computed(() => innerShadowSettings.value.useGlobalLight
  ? draftGlobalLight.value.angle
  : innerShadowSettings.value.angle)
const stroke = computed(() => draft.value.effects.find(
  (effect): effect is StrokeEffect => effect.type === 'stroke'
))
const strokeActive = computed(() => Boolean(stroke.value?.enabled))
const strokeColor = computed(() => {
  const paint = strokeSettings.value.paint
  return paint.type === 'color' ? paint.color : paint.type === 'gradient'
    ? paint.gradient.colorStops[0]?.color ?? '#000000'
    : '#000000'
})
const strokeGradientEnd = computed(() => {
  const paint = strokeSettings.value.paint
  return paint.type === 'gradient' ? paint.gradient.colorStops.at(-1)?.color ?? '#ffffff' : '#ffffff'
})
const colorOverlay = computed(() => draft.value.effects.find(
  (effect): effect is ColorOverlayEffect => effect.type === 'color-overlay'
))
const colorOverlayActive = computed(() => Boolean(colorOverlay.value?.enabled))
const gradientOverlay = computed(() => draft.value.effects.find(
  (effect): effect is GradientOverlayEffect => effect.type === 'gradient-overlay'
))
const gradientOverlayActive = computed(() => Boolean(gradientOverlay.value?.enabled))
const patternOverlay = computed(() => draft.value.effects.find(
  (effect): effect is PatternOverlayEffect => effect.type === 'pattern-overlay'
))
const patternOverlayActive = computed(() => Boolean(patternOverlay.value?.enabled))
const satin = computed(() => draft.value.effects.find(
  (effect): effect is SatinEffect => effect.type === 'satin'
))
const satinActive = computed(() => Boolean(satin.value?.enabled))
const bevelEmboss = computed(() => draft.value.effects.find(
  (effect): effect is BevelEmbossEffect => effect.type === 'bevel-emboss'
))
const bevelEmbossActive = computed(() => Boolean(bevelEmboss.value?.enabled))

function publishPreview() {
  if (previewEnabled.value) emit('preview', cloneLayerStyleConfig(draft.value), { ...draftGlobalLight.value })
}

function updateFillOpacity(value: number) {
  draft.value = {
    ...draft.value,
    fillOpacity: normalizeLayerStyleFillOpacity(value)
  }
  publishPreview()
}

function normalizedOuterGlow(value: OuterGlowEffect) {
  return normalizeLayerEffect(value) as OuterGlowEffect
}

function replaceOuterGlow(effect: OuterGlowEffect) {
  const index = draft.value.effects.findIndex((item) => item.id === effect.id)
  const effects = [...draft.value.effects]
  if (index >= 0) effects[index] = effect
  else effects.push(effect)
  draft.value = { ...draft.value, effects }
}

function updateOuterGlow(patch: Partial<OuterGlowEffect>) {
  outerGlowSettings.value = normalizedOuterGlow({ ...outerGlowSettings.value, ...patch })
  if (outerGlow.value) replaceOuterGlow(outerGlowSettings.value)
  publishPreview()
}

function toggleOuterGlow(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  outerGlowSettings.value = normalizedOuterGlow({ ...outerGlowSettings.value, enabled })
  if (!enabled && !outerGlowOriginallyPresent) {
    draft.value = {
      ...draft.value,
      effects: draft.value.effects.filter((effect) => effect.id !== outerGlowSettings.value.id)
    }
  } else {
    replaceOuterGlow(outerGlowSettings.value)
  }
  publishPreview()
}

function setOuterGlowPaint(type: 'color' | 'gradient') {
  if (type === 'color') {
    updateOuterGlow({ paint: { type: 'color', color: outerGlowColor.value } })
    return
  }
  updateOuterGlow({
    paint: {
      type: 'gradient',
      angle: 90,
      scale: 100,
      reverse: false,
      alignWithLayer: true,
      gradient: {
        type: 'linear',
        colorStops: [
          { position: 0, color: outerGlowColor.value },
          { position: 1, color: outerGlowGradientEnd.value }
        ],
        opacityStops: [{ position: 0, opacity: 100 }, { position: 1, opacity: 0 }],
        interpolation: 'srgb'
      }
    }
  })
}

function updateGradientColor(position: 0 | 1, color: string) {
  const paint = outerGlowSettings.value.paint
  if (paint.type !== 'gradient') return
  const colorStops = paint.gradient.colorStops.map((stop, index) => index === position ? { ...stop, color } : stop)
  updateOuterGlow({ paint: { ...paint, gradient: { ...paint.gradient, colorStops } } })
}

function normalizedInnerGlow(value: InnerGlowEffect) {
  return normalizeLayerEffect(value) as InnerGlowEffect
}

function replaceInnerGlow(effect: InnerGlowEffect) {
  const index = draft.value.effects.findIndex((item) => item.id === effect.id)
  const effects = [...draft.value.effects]
  if (index >= 0) effects[index] = effect
  else effects.push(effect)
  draft.value = { ...draft.value, effects }
}

function updateInnerGlow(patch: Partial<InnerGlowEffect>) {
  innerGlowSettings.value = normalizedInnerGlow({ ...innerGlowSettings.value, ...patch })
  if (innerGlow.value) replaceInnerGlow(innerGlowSettings.value)
  publishPreview()
}

function toggleInnerGlow(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  innerGlowSettings.value = normalizedInnerGlow({ ...innerGlowSettings.value, enabled })
  if (!enabled && !innerGlowOriginallyPresent) {
    draft.value = {
      ...draft.value,
      effects: draft.value.effects.filter((effect) => effect.id !== innerGlowSettings.value.id)
    }
  } else {
    replaceInnerGlow(innerGlowSettings.value)
  }
  publishPreview()
}

function setInnerGlowPaint(type: 'color' | 'gradient') {
  if (type === 'color') {
    updateInnerGlow({ paint: { type: 'color', color: innerGlowColor.value } })
    return
  }
  updateInnerGlow({
    paint: {
      type: 'gradient',
      angle: 90,
      scale: 100,
      reverse: false,
      alignWithLayer: true,
      gradient: {
        type: 'linear',
        colorStops: [
          { position: 0, color: innerGlowColor.value },
          { position: 1, color: innerGlowGradientEnd.value }
        ],
        opacityStops: [{ position: 0, opacity: 100 }, { position: 1, opacity: 0 }],
        interpolation: 'srgb'
      }
    }
  })
}

function updateInnerGradientColor(position: 0 | 1, color: string) {
  const paint = innerGlowSettings.value.paint
  if (paint.type !== 'gradient') return
  const colorStops = paint.gradient.colorStops.map((stop, index) => index === position ? { ...stop, color } : stop)
  updateInnerGlow({ paint: { ...paint, gradient: { ...paint.gradient, colorStops } } })
}

function normalizedDropShadow(value: DropShadowEffect) {
  return normalizeLayerEffect(value) as DropShadowEffect
}

function replaceDropShadow(effect: DropShadowEffect) {
  const index = draft.value.effects.findIndex((item) => item.id === effect.id)
  const effects = [...draft.value.effects]
  if (index >= 0) effects[index] = effect
  else effects.push(effect)
  draft.value = { ...draft.value, effects }
}

function updateDropShadow(patch: Partial<DropShadowEffect>) {
  dropShadowSettings.value = normalizedDropShadow({ ...dropShadowSettings.value, ...patch })
  if (dropShadow.value) replaceDropShadow(dropShadowSettings.value)
  publishPreview()
}

function toggleDropShadow(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  dropShadowSettings.value = normalizedDropShadow({ ...dropShadowSettings.value, enabled })
  if (!enabled && !dropShadowOriginallyPresent) {
    draft.value = {
      ...draft.value,
      effects: draft.value.effects.filter((effect) => effect.id !== dropShadowSettings.value.id)
    }
  } else {
    replaceDropShadow(dropShadowSettings.value)
  }
  publishPreview()
}

function updateDropShadowAngle(value: number) {
  const angle = normalizeLayerStyleGlobalLight({ ...draftGlobalLight.value, angle: value }).angle
  dropShadowSettings.value = normalizedDropShadow({ ...dropShadowSettings.value, angle })
  if (dropShadowSettings.value.useGlobalLight) {
    draftGlobalLight.value = { ...draftGlobalLight.value, angle }
  }
  if (dropShadow.value) replaceDropShadow(dropShadowSettings.value)
  publishPreview()
}

function normalizedInnerShadow(value: InnerShadowEffect) {
  return normalizeLayerEffect(value) as InnerShadowEffect
}

function replaceInnerShadow(effect: InnerShadowEffect) {
  const index = draft.value.effects.findIndex((item) => item.id === effect.id)
  const effects = [...draft.value.effects]
  if (index >= 0) effects[index] = effect
  else effects.push(effect)
  draft.value = { ...draft.value, effects }
}

function updateInnerShadow(patch: Partial<InnerShadowEffect>) {
  innerShadowSettings.value = normalizedInnerShadow({ ...innerShadowSettings.value, ...patch })
  if (innerShadow.value) replaceInnerShadow(innerShadowSettings.value)
  publishPreview()
}

function toggleInnerShadow(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  innerShadowSettings.value = normalizedInnerShadow({ ...innerShadowSettings.value, enabled })
  if (!enabled && !innerShadowOriginallyPresent) {
    draft.value = {
      ...draft.value,
      effects: draft.value.effects.filter((effect) => effect.id !== innerShadowSettings.value.id)
    }
  } else {
    replaceInnerShadow(innerShadowSettings.value)
  }
  publishPreview()
}

function updateInnerShadowAngle(value: number) {
  const angle = normalizeLayerStyleGlobalLight({ ...draftGlobalLight.value, angle: value }).angle
  innerShadowSettings.value = normalizedInnerShadow({ ...innerShadowSettings.value, angle })
  if (innerShadowSettings.value.useGlobalLight) {
    draftGlobalLight.value = { ...draftGlobalLight.value, angle }
  }
  if (innerShadow.value) replaceInnerShadow(innerShadowSettings.value)
  publishPreview()
}

function normalizedStroke(value: StrokeEffect) {
  return normalizeLayerEffect(value) as StrokeEffect
}

function replaceStroke(effect: StrokeEffect) {
  const index = draft.value.effects.findIndex((item) => item.id === effect.id)
  const effects = [...draft.value.effects]
  if (index >= 0) effects[index] = effect
  else effects.push(effect)
  draft.value = { ...draft.value, effects }
}

function updateStroke(patch: Partial<StrokeEffect>) {
  strokeSettings.value = normalizedStroke({ ...strokeSettings.value, ...patch })
  if (stroke.value) replaceStroke(strokeSettings.value)
  publishPreview()
}

function toggleStroke(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  strokeSettings.value = normalizedStroke({ ...strokeSettings.value, enabled })
  if (!enabled && !strokeOriginallyPresent) {
    draft.value = {
      ...draft.value,
      effects: draft.value.effects.filter((effect) => effect.id !== strokeSettings.value.id)
    }
  } else {
    replaceStroke(strokeSettings.value)
  }
  publishPreview()
}

function setStrokePaint(type: 'color' | 'gradient' | 'pattern') {
  if (type === 'color') {
    updateStroke({ paint: { type: 'color', color: strokeColor.value } })
    return
  }
  if (type === 'pattern') {
    const previous = strokeSettings.value.paint
    updateStroke({
      paint: {
        type: 'pattern',
        pattern: previous.type === 'pattern' ? previous.pattern : undefined,
        angle: 0,
        scale: 100,
        linkWithLayer: true
      }
    })
    return
  }
  updateStroke({
    paint: {
      type: 'gradient',
      angle: 0,
      scale: 100,
      reverse: false,
      alignWithLayer: true,
      gradient: {
        type: 'linear',
        colorStops: [
          { position: 0, color: strokeColor.value },
          { position: 1, color: strokeGradientEnd.value }
        ],
        opacityStops: [{ position: 0, opacity: 100 }, { position: 1, opacity: 100 }],
        interpolation: 'srgb'
      }
    }
  })
}

function updateStrokeGradientColor(position: 0 | 1, color: string) {
  const paint = strokeSettings.value.paint
  if (paint.type !== 'gradient') return
  const colorStops = paint.gradient.colorStops.map((stop, index) => index === position ? { ...stop, color } : stop)
  updateStroke({ paint: { ...paint, gradient: { ...paint.gradient, colorStops } } })
}

function updateStrokeGradient(patch: Partial<LayerStyleGradient>) {
  const paint = strokeSettings.value.paint
  if (paint.type !== 'gradient') return
  updateStroke({ paint: { ...paint, gradient: { ...paint.gradient, ...patch } } })
}

function updateStrokeGradientOptions(patch: Partial<{ angle: number; scale: number; reverse: boolean }>) {
  const paint = strokeSettings.value.paint
  if (paint.type !== 'gradient') return
  updateStroke({ paint: { ...paint, ...patch } })
}

function updateStrokePattern(asset: LayerStylePatternAsset) {
  const paint = strokeSettings.value.paint
  if (paint.type !== 'pattern') return
  sessionPatternUrls.add(asset.sourceUrl)
  updateStroke({ paint: { ...paint, pattern: asset } })
}

function updateStrokePatternOptions(patch: Partial<{ angle: number; scale: number }>) {
  const paint = strokeSettings.value.paint
  if (paint.type !== 'pattern') return
  updateStroke({ paint: { ...paint, ...patch } })
}

function normalizedColorOverlay(value: ColorOverlayEffect) {
  return normalizeLayerEffect(value) as ColorOverlayEffect
}

function replaceColorOverlay(effect: ColorOverlayEffect) {
  const index = draft.value.effects.findIndex((item) => item.id === effect.id)
  const effects = [...draft.value.effects]
  if (index >= 0) effects[index] = effect
  else effects.push(effect)
  draft.value = { ...draft.value, effects }
}

function updateColorOverlay(patch: Partial<ColorOverlayEffect>) {
  colorOverlaySettings.value = normalizedColorOverlay({ ...colorOverlaySettings.value, ...patch })
  if (colorOverlay.value) replaceColorOverlay(colorOverlaySettings.value)
  publishPreview()
}

function toggleColorOverlay(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  colorOverlaySettings.value = normalizedColorOverlay({ ...colorOverlaySettings.value, enabled })
  if (!enabled && !colorOverlayOriginallyPresent) {
    draft.value = {
      ...draft.value,
      effects: draft.value.effects.filter((effect) => effect.id !== colorOverlaySettings.value.id)
    }
  } else {
    replaceColorOverlay(colorOverlaySettings.value)
  }
  publishPreview()
}

function normalizedGradientOverlay(value: GradientOverlayEffect) {
  return normalizeLayerEffect(value) as GradientOverlayEffect
}

function replaceGradientOverlay(effect: GradientOverlayEffect) {
  const index = draft.value.effects.findIndex((item) => item.id === effect.id)
  const effects = [...draft.value.effects]
  if (index >= 0) effects[index] = effect
  else effects.push(effect)
  draft.value = { ...draft.value, effects }
}

function updateGradientOverlay(patch: Partial<GradientOverlayEffect>) {
  gradientOverlaySettings.value = normalizedGradientOverlay({ ...gradientOverlaySettings.value, ...patch })
  if (gradientOverlay.value) replaceGradientOverlay(gradientOverlaySettings.value)
  publishPreview()
}

function toggleGradientOverlay(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  gradientOverlaySettings.value = normalizedGradientOverlay({ ...gradientOverlaySettings.value, enabled })
  if (!enabled && !gradientOverlayOriginallyPresent) {
    draft.value = {
      ...draft.value,
      effects: draft.value.effects.filter((effect) => effect.id !== gradientOverlaySettings.value.id)
    }
  } else {
    replaceGradientOverlay(gradientOverlaySettings.value)
  }
  publishPreview()
}

function normalizedPatternOverlay(value: PatternOverlayEffect) {
  return normalizeLayerEffect(value) as PatternOverlayEffect
}

function replacePatternOverlay(effect: PatternOverlayEffect) {
  const index = draft.value.effects.findIndex((item) => item.id === effect.id)
  const effects = [...draft.value.effects]
  if (index >= 0) effects[index] = effect
  else effects.push(effect)
  draft.value = { ...draft.value, effects }
}

function updatePatternOverlay(patch: Partial<PatternOverlayEffect>) {
  if (patch.pattern) sessionPatternUrls.add(patch.pattern.sourceUrl)
  patternOverlaySettings.value = normalizedPatternOverlay({ ...patternOverlaySettings.value, ...patch })
  if (patternOverlay.value) replacePatternOverlay(patternOverlaySettings.value)
  publishPreview()
}

function togglePatternOverlay(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  patternOverlaySettings.value = normalizedPatternOverlay({ ...patternOverlaySettings.value, enabled })
  if (!enabled && !patternOverlayOriginallyPresent) {
    draft.value = {
      ...draft.value,
      effects: draft.value.effects.filter((effect) => effect.id !== patternOverlaySettings.value.id)
    }
  } else {
    replacePatternOverlay(patternOverlaySettings.value)
  }
  publishPreview()
}

function normalizedSatin(value: SatinEffect) {
  return normalizeLayerEffect(value) as SatinEffect
}

function replaceSatin(effect: SatinEffect) {
  const index = draft.value.effects.findIndex((item) => item.id === effect.id)
  const effects = [...draft.value.effects]
  if (index >= 0) effects[index] = effect
  else effects.push(effect)
  draft.value = { ...draft.value, effects }
}

function updateSatin(patch: Partial<SatinEffect>) {
  satinSettings.value = normalizedSatin({ ...satinSettings.value, ...patch })
  if (satin.value) replaceSatin(satinSettings.value)
  publishPreview()
}

function toggleSatin(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  satinSettings.value = normalizedSatin({ ...satinSettings.value, enabled })
  if (!enabled && !satinOriginallyPresent) {
    draft.value = {
      ...draft.value,
      effects: draft.value.effects.filter((effect) => effect.id !== satinSettings.value.id)
    }
  } else {
    replaceSatin(satinSettings.value)
  }
  publishPreview()
}

function normalizedBevelEmboss(value: BevelEmbossEffect) {
  return normalizeLayerEffect(value) as BevelEmbossEffect
}

function replaceBevelEmboss(effect: BevelEmbossEffect) {
  const index = draft.value.effects.findIndex((item) => item.id === effect.id)
  const effects = [...draft.value.effects]
  if (index >= 0) effects[index] = effect
  else effects.push(effect)
  draft.value = { ...draft.value, effects }
}

function updateBevelEmboss(patch: Partial<BevelEmbossEffect>) {
  bevelEmbossSettings.value = normalizedBevelEmboss({ ...bevelEmbossSettings.value, ...patch })
  if (bevelEmboss.value) replaceBevelEmboss(bevelEmbossSettings.value)
  publishPreview()
}

function toggleBevelEmboss(event: Event) {
  const enabled = (event.target as HTMLInputElement).checked
  bevelEmbossSettings.value = normalizedBevelEmboss({ ...bevelEmbossSettings.value, enabled })
  if (!enabled && !bevelEmbossOriginallyPresent) {
    draft.value = {
      ...draft.value,
      effects: draft.value.effects.filter((effect) => effect.id !== bevelEmbossSettings.value.id)
    }
  } else {
    replaceBevelEmboss(bevelEmbossSettings.value)
  }
  publishPreview()
}

function updateBevelEmbossAngle(value: number) {
  const angle = normalizeLayerStyleGlobalLight({ ...draftGlobalLight.value, angle: value }).angle
  bevelEmbossSettings.value = normalizedBevelEmboss({ ...bevelEmbossSettings.value, angle })
  if (bevelEmbossSettings.value.useGlobalLight) {
    draftGlobalLight.value = { ...draftGlobalLight.value, angle }
  }
  if (bevelEmboss.value) replaceBevelEmboss(bevelEmbossSettings.value)
  publishPreview()
}

function selectBevelEmbossTexture(asset: LayerStylePatternAsset) {
  sessionPatternUrls.add(asset.sourceUrl)
  updateBevelEmboss({ texture: asset })
}

function togglePreview(event: Event) {
  previewEnabled.value = (event.target as HTMLInputElement).checked
  emit(
    'preview',
    cloneLayerStyleConfig(previewEnabled.value ? draft.value : props.styles),
    previewEnabled.value ? { ...draftGlobalLight.value } : normalizeLayerStyleGlobalLight(props.globalLight)
  )
}

function restoreDefault() {
  if (selectedCategory.value === 'blending') {
    updateFillOpacity(100)
    return
  }
  if (selectedCategory.value === 'outer-glow') {
    const replacement = createDefaultLayerEffect('outer-glow', outerGlowSettings.value.id) as OuterGlowEffect
    outerGlowSettings.value = { ...replacement, enabled: outerGlowActive.value }
    if (outerGlow.value) replaceOuterGlow(outerGlowSettings.value)
  } else if (selectedCategory.value === 'inner-glow') {
    const replacement = createDefaultLayerEffect('inner-glow', innerGlowSettings.value.id) as InnerGlowEffect
    innerGlowSettings.value = { ...replacement, enabled: innerGlowActive.value }
    if (innerGlow.value) replaceInnerGlow(innerGlowSettings.value)
  } else if (selectedCategory.value === 'drop-shadow') {
    const replacement = createDefaultLayerEffect('drop-shadow', dropShadowSettings.value.id) as DropShadowEffect
    dropShadowSettings.value = { ...replacement, enabled: dropShadowActive.value }
    if (dropShadow.value) replaceDropShadow(dropShadowSettings.value)
  } else if (selectedCategory.value === 'inner-shadow') {
    const replacement = createDefaultLayerEffect('inner-shadow', innerShadowSettings.value.id) as InnerShadowEffect
    innerShadowSettings.value = { ...replacement, enabled: innerShadowActive.value }
    if (innerShadow.value) replaceInnerShadow(innerShadowSettings.value)
  } else if (selectedCategory.value === 'stroke') {
    const replacement = createDefaultLayerEffect('stroke', strokeSettings.value.id) as StrokeEffect
    strokeSettings.value = { ...replacement, enabled: strokeActive.value }
    if (stroke.value) replaceStroke(strokeSettings.value)
  } else if (selectedCategory.value === 'color-overlay') {
    const replacement = createDefaultLayerEffect('color-overlay', colorOverlaySettings.value.id) as ColorOverlayEffect
    colorOverlaySettings.value = { ...replacement, enabled: colorOverlayActive.value }
    if (colorOverlay.value) replaceColorOverlay(colorOverlaySettings.value)
  } else if (selectedCategory.value === 'gradient-overlay') {
    const replacement = createDefaultLayerEffect('gradient-overlay', gradientOverlaySettings.value.id) as GradientOverlayEffect
    gradientOverlaySettings.value = { ...replacement, enabled: gradientOverlayActive.value }
    if (gradientOverlay.value) replaceGradientOverlay(gradientOverlaySettings.value)
  } else if (selectedCategory.value === 'pattern-overlay') {
    const replacement = createDefaultLayerEffect('pattern-overlay', patternOverlaySettings.value.id) as PatternOverlayEffect
    patternOverlaySettings.value = { ...replacement, enabled: patternOverlayActive.value, pattern: patternOverlaySettings.value.pattern }
    if (patternOverlay.value) replacePatternOverlay(patternOverlaySettings.value)
  } else if (selectedCategory.value === 'satin') {
    const replacement = createDefaultLayerEffect('satin', satinSettings.value.id) as SatinEffect
    satinSettings.value = { ...replacement, enabled: satinActive.value }
    if (satin.value) replaceSatin(satinSettings.value)
  } else {
    const replacement = createDefaultLayerEffect('bevel-emboss', bevelEmbossSettings.value.id) as BevelEmbossEffect
    bevelEmbossSettings.value = { ...replacement, enabled: bevelEmbossActive.value }
    if (bevelEmboss.value) replaceBevelEmboss(bevelEmbossSettings.value)
  }
  publishPreview()
}

function viewportSize() {
  return { width: window.innerWidth, height: window.innerHeight }
}

function finishPointerInteraction(event?: PointerEvent) {
  const interaction = pointerInteraction
  if (!interaction || (event && event.pointerId !== interaction.pointerId)) return
  pointerInteraction = undefined
  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', finishPointerInteraction)
  window.removeEventListener('pointercancel', finishPointerInteraction)
  if (interaction.target.hasPointerCapture?.(interaction.pointerId)) {
    interaction.target.releasePointerCapture(interaction.pointerId)
  }
  document.body.style.cursor = previousBodyCursor
  document.body.style.userSelect = previousBodyUserSelect
}

function handlePointerMove(event: PointerEvent) {
  const interaction = pointerInteraction
  if (!interaction || event.pointerId !== interaction.pointerId) return
  event.preventDefault()
  const deltaX = event.clientX - interaction.startClientX
  const deltaY = event.clientY - interaction.startClientY
  dialogRect.value = interaction.kind === 'move'
    ? moveFloatingWindow(interaction.startRect, deltaX, deltaY, viewportSize(), MINIMUM_DIALOG_SIZE)
    : resizeFloatingWindow(
        interaction.startRect,
        interaction.corner!,
        deltaX,
        deltaY,
        viewportSize(),
        MINIMUM_DIALOG_SIZE
      )
}

function startPointerInteraction(
  event: PointerEvent,
  kind: 'move' | 'resize',
  corner?: FloatingWindowCorner
) {
  if (event.button !== 0 || pointerInteraction) return
  event.preventDefault()
  const target = event.currentTarget as HTMLElement
  target.setPointerCapture?.(event.pointerId)
  pointerInteraction = {
    corner,
    kind,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startRect: { ...dialogRect.value },
    target
  }
  previousBodyCursor = document.body.style.cursor
  previousBodyUserSelect = document.body.style.userSelect
  document.body.style.cursor = kind === 'move'
    ? 'move'
    : corner === 'north-west' || corner === 'south-east' ? 'nwse-resize' : 'nesw-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', handlePointerMove, { passive: false })
  window.addEventListener('pointerup', finishPointerInteraction)
  window.addEventListener('pointercancel', finishPointerInteraction)
}

function beginMove(event: PointerEvent) {
  if ((event.target as HTMLElement).closest('button, input, select, textarea, a')) return
  startPointerInteraction(event, 'move')
}

function beginResize(event: PointerEvent, corner: FloatingWindowCorner) {
  startPointerInteraction(event, 'resize', corner)
}

function fitDialogToViewport() {
  if (!props.open) return
  dialogRect.value = fitFloatingWindow(dialogRect.value, viewportSize(), MINIMUM_DIALOG_SIZE)
}

function revokeOrphanedPatternUrls(survivors: LayerStyleConfig) {
  const keep = new Set(layerStylePatternAssets(survivors).map((asset) => asset.sourceUrl))
  for (const url of sessionPatternUrls) {
    if (!keep.has(url)) URL.revokeObjectURL(url)
  }
  sessionPatternUrls.clear()
}

function cancelDialog() {
  revokeOrphanedPatternUrls(props.styles)
  emit('cancel')
}

function applyDialog() {
  revokeOrphanedPatternUrls(draft.value)
  emit('apply', cloneLayerStyleConfig(draft.value), { ...draftGlobalLight.value })
}

function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancelDialog()
    return
  }
  if (event.key !== 'Tab' || !dialog.value) return
  const focusable = Array.from(dialog.value.querySelectorAll<HTMLElement>(
    'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => element.offsetParent !== null)
  const first = focusable[0]
  const last = focusable.at(-1)
  if (!first || !last) return
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

watch(() => props.open, async (open) => {
  if (!open) {
    finishPointerInteraction()
    return
  }
  dialogRect.value = dialogPositioned
    ? fitFloatingWindow(dialogRect.value, viewportSize(), MINIMUM_DIALOG_SIZE)
    : centerFloatingWindow(viewportSize(), DEFAULT_DIALOG_SIZE, MINIMUM_DIALOG_SIZE)
  dialogPositioned = true
  draft.value = cloneLayerStyleConfig(props.styles)
  draftGlobalLight.value = normalizeLayerStyleGlobalLight(props.globalLight)
  const existing = draft.value.effects.find((effect): effect is OuterGlowEffect => effect.type === 'outer-glow')
  outerGlowOriginallyPresent = Boolean(existing)
  outerGlowSettings.value = existing
    ? normalizedOuterGlow(existing)
    : createDefaultLayerEffect('outer-glow') as OuterGlowEffect
  const existingInner = draft.value.effects.find((effect): effect is InnerGlowEffect => effect.type === 'inner-glow')
  innerGlowOriginallyPresent = Boolean(existingInner)
  innerGlowSettings.value = existingInner
    ? normalizedInnerGlow(existingInner)
    : createDefaultLayerEffect('inner-glow') as InnerGlowEffect
  const existingShadow = draft.value.effects.find((effect): effect is DropShadowEffect => effect.type === 'drop-shadow')
  dropShadowOriginallyPresent = Boolean(existingShadow)
  dropShadowSettings.value = existingShadow
    ? normalizedDropShadow(existingShadow)
    : createDefaultLayerEffect('drop-shadow') as DropShadowEffect
  const existingInnerShadow = draft.value.effects.find((effect): effect is InnerShadowEffect => effect.type === 'inner-shadow')
  innerShadowOriginallyPresent = Boolean(existingInnerShadow)
  innerShadowSettings.value = existingInnerShadow
    ? normalizedInnerShadow(existingInnerShadow)
    : createDefaultLayerEffect('inner-shadow') as InnerShadowEffect
  const existingStroke = draft.value.effects.find((effect): effect is StrokeEffect => effect.type === 'stroke')
  strokeOriginallyPresent = Boolean(existingStroke)
  strokeSettings.value = existingStroke
    ? normalizedStroke(existingStroke)
    : createDefaultLayerEffect('stroke') as StrokeEffect
  const existingColorOverlay = draft.value.effects.find((effect): effect is ColorOverlayEffect => effect.type === 'color-overlay')
  colorOverlayOriginallyPresent = Boolean(existingColorOverlay)
  colorOverlaySettings.value = existingColorOverlay
    ? normalizedColorOverlay(existingColorOverlay)
    : createDefaultLayerEffect('color-overlay') as ColorOverlayEffect
  const existingGradientOverlay = draft.value.effects.find((effect): effect is GradientOverlayEffect => effect.type === 'gradient-overlay')
  gradientOverlayOriginallyPresent = Boolean(existingGradientOverlay)
  gradientOverlaySettings.value = existingGradientOverlay
    ? normalizedGradientOverlay(existingGradientOverlay)
    : createDefaultLayerEffect('gradient-overlay') as GradientOverlayEffect
  const existingPatternOverlay = draft.value.effects.find((effect): effect is PatternOverlayEffect => effect.type === 'pattern-overlay')
  patternOverlayOriginallyPresent = Boolean(existingPatternOverlay)
  patternOverlaySettings.value = existingPatternOverlay
    ? normalizedPatternOverlay(existingPatternOverlay)
    : createDefaultLayerEffect('pattern-overlay') as PatternOverlayEffect
  sessionPatternUrls.clear()
  const existingSatin = draft.value.effects.find((effect): effect is SatinEffect => effect.type === 'satin')
  satinOriginallyPresent = Boolean(existingSatin)
  satinSettings.value = existingSatin
    ? normalizedSatin(existingSatin)
    : createDefaultLayerEffect('satin') as SatinEffect
  const existingBevelEmboss = draft.value.effects.find((effect): effect is BevelEmbossEffect => effect.type === 'bevel-emboss')
  bevelEmbossOriginallyPresent = Boolean(existingBevelEmboss)
  bevelEmbossSettings.value = existingBevelEmboss
    ? normalizedBevelEmboss(existingBevelEmboss)
    : createDefaultLayerEffect('bevel-emboss') as BevelEmbossEffect
  selectedCategory.value = 'blending'
  if (props.rasterEffectsAvailable) {
    if (existingShadow?.enabled) selectedCategory.value = 'drop-shadow'
    else if (existingInnerShadow?.enabled) selectedCategory.value = 'inner-shadow'
    else if (existing?.enabled) selectedCategory.value = 'outer-glow'
    else if (existingInner?.enabled) selectedCategory.value = 'inner-glow'
    else if (existingStroke?.enabled) selectedCategory.value = 'stroke'
    else if (existingColorOverlay?.enabled) selectedCategory.value = 'color-overlay'
    else if (existingGradientOverlay?.enabled) selectedCategory.value = 'gradient-overlay'
    else if (existingPatternOverlay?.enabled) selectedCategory.value = 'pattern-overlay'
    else if (existingSatin?.enabled) selectedCategory.value = 'satin'
    else if (existingBevelEmboss?.enabled) selectedCategory.value = 'bevel-emboss'
  }
  previewEnabled.value = true
  await nextTick()
  initialFocus.value?.focus()
})

onMounted(() => window.addEventListener('resize', fitDialogToViewport))

onBeforeUnmount(() => {
  finishPointerInteraction()
  window.removeEventListener('resize', fitDialogToViewport)
})
</script>

<template>
  <div
    v-if="open"
    class="dialog-backdrop dialog-backdrop--layer-style"
    role="presentation"
  >
    <section
      ref="dialog"
      class="layer-style-dialog"
      :style="dialogStyle"
      aria-modal="true"
      role="dialog"
      aria-labelledby="layer-style-title"
      @keydown="handleKeydown"
    >
      <header class="dialog-header layer-style-dialog-header" @pointerdown="beginMove">
        <div>
          <h2 id="layer-style-title">Opções de mesclagem</h2>
          <span :title="layerName">{{ layerName }}</span>
        </div>
        <button type="button" title="Fechar" aria-label="Fechar" @click="cancelDialog">×</button>
      </header>

      <div class="layer-style-layout">
        <nav class="layer-style-navigation" aria-label="Categorias de estilo">
          <button
            ref="initialFocus"
            :class="{ 'layer-style-navigation--active': selectedCategory === 'blending' }"
            type="button"
            @click="selectedCategory = 'blending'"
          >
            Mesclagem
          </button>
          <span class="layer-style-effect-entry">
            <input
              :checked="dropShadowActive"
              :disabled="!rasterEffectsAvailable"
              type="checkbox"
              aria-label="Ativar sombra projetada"
              :title="rasterEffectsAvailable ? 'Ativar sombra projetada' : 'Disponível para camadas raster'"
              @change="toggleDropShadow"
            />
            <button
              :class="{ 'layer-style-navigation--active': selectedCategory === 'drop-shadow' }"
              :disabled="!rasterEffectsAvailable"
              type="button"
              :title="rasterEffectsAvailable ? 'Editar sombra projetada' : 'Disponível para camadas raster'"
              @click="selectedCategory = 'drop-shadow'"
            >
              Sombra projetada
            </button>
          </span>
          <span class="layer-style-effect-entry">
            <input
              :checked="innerShadowActive"
              :disabled="!rasterEffectsAvailable"
              type="checkbox"
              aria-label="Ativar sombra interna"
              :title="rasterEffectsAvailable ? 'Ativar sombra interna' : 'Disponível para camadas raster'"
              @change="toggleInnerShadow"
            />
            <button
              :class="{ 'layer-style-navigation--active': selectedCategory === 'inner-shadow' }"
              :disabled="!rasterEffectsAvailable"
              type="button"
              :title="rasterEffectsAvailable ? 'Editar sombra interna' : 'Disponível para camadas raster'"
              @click="selectedCategory = 'inner-shadow'"
            >
              Sombra interna
            </button>
          </span>
          <span class="layer-style-effect-entry">
            <input
              :checked="outerGlowActive"
              :disabled="!rasterEffectsAvailable"
              type="checkbox"
              aria-label="Ativar brilho externo"
              :title="rasterEffectsAvailable ? 'Ativar brilho externo' : 'Disponível para camadas raster'"
              @change="toggleOuterGlow"
            />
            <button
              :class="{ 'layer-style-navigation--active': selectedCategory === 'outer-glow' }"
              :disabled="!rasterEffectsAvailable"
              type="button"
              :title="rasterEffectsAvailable ? 'Editar brilho externo' : 'Disponível para camadas raster'"
              @click="selectedCategory = 'outer-glow'"
            >
              Brilho externo
            </button>
          </span>
          <span class="layer-style-effect-entry">
            <input
              :checked="innerGlowActive"
              :disabled="!rasterEffectsAvailable"
              type="checkbox"
              aria-label="Ativar brilho interno"
              :title="rasterEffectsAvailable ? 'Ativar brilho interno' : 'Disponível para camadas raster'"
              @change="toggleInnerGlow"
            />
            <button
              :class="{ 'layer-style-navigation--active': selectedCategory === 'inner-glow' }"
              :disabled="!rasterEffectsAvailable"
              type="button"
              :title="rasterEffectsAvailable ? 'Editar brilho interno' : 'Disponível para camadas raster'"
              @click="selectedCategory = 'inner-glow'"
            >
              Brilho interno
            </button>
          </span>
          <span class="layer-style-effect-entry">
            <input
              :checked="strokeActive"
              :disabled="!rasterEffectsAvailable"
              type="checkbox"
              aria-label="Ativar traçado"
              :title="rasterEffectsAvailable ? 'Ativar traçado' : 'Disponível para camadas raster'"
              @change="toggleStroke"
            />
            <button
              :class="{ 'layer-style-navigation--active': selectedCategory === 'stroke' }"
              :disabled="!rasterEffectsAvailable"
              type="button"
              :title="rasterEffectsAvailable ? 'Editar traçado' : 'Disponível para camadas raster'"
              @click="selectedCategory = 'stroke'"
            >
              Traçado
            </button>
          </span>
          <span class="layer-style-effect-entry">
            <input
              :checked="colorOverlayActive"
              :disabled="!rasterEffectsAvailable"
              type="checkbox"
              aria-label="Ativar sobreposição de cor"
              :title="rasterEffectsAvailable ? 'Ativar sobreposição de cor' : 'Disponível para camadas raster'"
              @change="toggleColorOverlay"
            />
            <button
              :class="{ 'layer-style-navigation--active': selectedCategory === 'color-overlay' }"
              :disabled="!rasterEffectsAvailable"
              type="button"
              :title="rasterEffectsAvailable ? 'Editar sobreposição de cor' : 'Disponível para camadas raster'"
              @click="selectedCategory = 'color-overlay'"
            >
              Sobreposição de cor
            </button>
          </span>
          <span class="layer-style-effect-entry">
            <input
              :checked="gradientOverlayActive"
              :disabled="!rasterEffectsAvailable"
              type="checkbox"
              aria-label="Ativar sobreposição de gradiente"
              :title="rasterEffectsAvailable ? 'Ativar sobreposição de gradiente' : 'Disponível para camadas raster'"
              @change="toggleGradientOverlay"
            />
            <button
              :class="{ 'layer-style-navigation--active': selectedCategory === 'gradient-overlay' }"
              :disabled="!rasterEffectsAvailable"
              type="button"
              :title="rasterEffectsAvailable ? 'Editar sobreposição de gradiente' : 'Disponível para camadas raster'"
              @click="selectedCategory = 'gradient-overlay'"
            >
              Sobreposição de gradiente
            </button>
          </span>
          <span class="layer-style-effect-entry">
            <input
              :checked="patternOverlayActive"
              :disabled="!rasterEffectsAvailable"
              type="checkbox"
              aria-label="Ativar sobreposição de padrão"
              :title="rasterEffectsAvailable ? 'Ativar sobreposição de padrão' : 'Disponível para camadas raster'"
              @change="togglePatternOverlay"
            />
            <button
              :class="{ 'layer-style-navigation--active': selectedCategory === 'pattern-overlay' }"
              :disabled="!rasterEffectsAvailable"
              type="button"
              :title="rasterEffectsAvailable ? 'Editar sobreposição de padrão' : 'Disponível para camadas raster'"
              @click="selectedCategory = 'pattern-overlay'"
            >
              Sobreposição de padrão
            </button>
          </span>
          <span class="layer-style-effect-entry">
            <input
              :checked="satinActive"
              :disabled="!rasterEffectsAvailable"
              type="checkbox"
              aria-label="Ativar acetinado"
              :title="rasterEffectsAvailable ? 'Ativar acetinado' : 'Disponível para camadas raster'"
              @change="toggleSatin"
            />
            <button
              :class="{ 'layer-style-navigation--active': selectedCategory === 'satin' }"
              :disabled="!rasterEffectsAvailable"
              type="button"
              :title="rasterEffectsAvailable ? 'Editar acetinado' : 'Disponível para camadas raster'"
              @click="selectedCategory = 'satin'"
            >
              Acetinado
            </button>
          </span>
          <span class="layer-style-effect-entry">
            <input
              :checked="bevelEmbossActive"
              :disabled="!rasterEffectsAvailable"
              type="checkbox"
              aria-label="Ativar bisel e entalhe"
              :title="rasterEffectsAvailable ? 'Ativar bisel e entalhe' : 'Disponível para camadas raster'"
              @change="toggleBevelEmboss"
            />
            <button
              :class="{ 'layer-style-navigation--active': selectedCategory === 'bevel-emboss' }"
              :disabled="!rasterEffectsAvailable"
              type="button"
              :title="rasterEffectsAvailable ? 'Editar bisel e entalhe' : 'Disponível para camadas raster'"
              @click="selectedCategory = 'bevel-emboss'"
            >
              Bisel e entalhe
            </button>
          </span>
        </nav>

        <div v-if="selectedCategory === 'blending'" class="layer-style-controls">
          <h3>Mesclagem avançada</h3>
          <label class="layer-style-range">
            <span>Opacidade de preenchimento</span>
            <span class="layer-style-range-controls">
              <input
                :value="draft.fillOpacity"
                max="100"
                min="0"
                step="1"
                type="range"
                @input="updateFillOpacity(Number(($event.target as HTMLInputElement).value))"
              />
              <span class="layer-style-number">
                <input
                  :value="draft.fillOpacity"
                  max="100"
                  min="0"
                  step="1"
                  type="number"
                  @input="updateFillOpacity(Number(($event.target as HTMLInputElement).value))"
                />
                <span aria-hidden="true">%</span>
              </span>
            </span>
          </label>
        </div>

        <div v-else-if="selectedCategory === 'drop-shadow'" class="layer-style-controls layer-style-controls--scrollable">
          <h3>Sombra projetada</h3>
          <div class="layer-style-grid">
            <label>
              Cor
              <input
                class="layer-style-color"
                :value="dropShadowSettings.color"
                type="color"
                @input="updateDropShadow({ color: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label>
              Modo
              <select
                :value="dropShadowSettings.blendMode"
                @change="updateDropShadow({ blendMode: ($event.target as HTMLSelectElement).value as DropShadowEffect['blendMode'] })"
              >
                <option value="normal">Normal</option>
                <option value="multiply">Multiplicação</option>
                <option value="screen">Divisão</option>
                <option value="overlay">Sobrepor</option>
                <option value="lighten">Clarear</option>
                <option value="darken">Escurecer</option>
              </select>
            </label>
            <label>
              Ângulo
              <span class="layer-style-number">
                <input
                  :value="dropShadowAngle"
                  max="180"
                  min="-180"
                  step="1"
                  type="number"
                  @input="updateDropShadowAngle(Number(($event.target as HTMLInputElement).value))"
                />
                <span aria-hidden="true">°</span>
              </span>
            </label>
            <label class="layer-style-preview-toggle">
              <input
                :checked="dropShadowSettings.useGlobalLight"
                type="checkbox"
                @change="updateDropShadow({ useGlobalLight: ($event.target as HTMLInputElement).checked })"
              />
              <span>Usar luz global</span>
            </label>
          </div>

          <div class="layer-style-slider-list">
            <label v-for="control in [
              { key: 'opacity', label: 'Opacidade', value: dropShadowSettings.opacity, max: 100, suffix: '%' },
              { key: 'distance', label: 'Distância', value: dropShadowSettings.distance, max: 1000, suffix: 'px' },
              { key: 'spread', label: 'Expansão', value: dropShadowSettings.spread, max: 100, suffix: '%' },
              { key: 'size', label: 'Tamanho', value: dropShadowSettings.size, max: 250, suffix: 'px' },
              { key: 'noise', label: 'Ruído', value: dropShadowSettings.noise, max: 100, suffix: '%' }
            ]" :key="control.key" class="layer-style-parameter">
              <span>{{ control.label }}</span>
              <input
                :value="control.value"
                :max="control.max"
                min="0"
                type="range"
                @input="updateDropShadow({ [control.key]: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="layer-style-parameter-value">
                <input
                  :value="control.value"
                  :max="control.max"
                  min="0"
                  type="number"
                  @input="updateDropShadow({ [control.key]: Number(($event.target as HTMLInputElement).value) })"
                />
                <span aria-hidden="true">{{ control.suffix }}</span>
              </span>
            </label>
          </div>

          <label class="layer-style-contour">
            <span>Contorno</span>
            <select
              :value="dropShadowSettings.contour.preset"
              @change="updateDropShadow({ contour: { ...dropShadowSettings.contour, preset: ($event.target as HTMLSelectElement).value as DropShadowEffect['contour']['preset'] } })"
            >
              <option value="linear">Linear</option>
              <option value="gaussian">Gaussiano</option>
              <option value="cone">Cone</option>
              <option value="inverted-cone">Cone invertido</option>
              <option value="ring">Anel</option>
            </select>
          </label>
          <label class="layer-style-preview-toggle">
            <input
              :checked="dropShadowSettings.layerKnocksOutShadow"
              type="checkbox"
              @change="updateDropShadow({ layerKnocksOutShadow: ($event.target as HTMLInputElement).checked })"
            />
            <span>A camada recorta a própria sombra</span>
          </label>
        </div>

        <div v-else-if="selectedCategory === 'inner-shadow'" class="layer-style-controls layer-style-controls--scrollable">
          <h3>Sombra interna</h3>
          <div class="layer-style-grid">
            <label>
              Cor
              <input
                class="layer-style-color"
                :value="innerShadowSettings.color"
                type="color"
                @input="updateInnerShadow({ color: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label>
              Modo
              <select
                :value="innerShadowSettings.blendMode"
                @change="updateInnerShadow({ blendMode: ($event.target as HTMLSelectElement).value as InnerShadowEffect['blendMode'] })"
              >
                <option value="normal">Normal</option>
                <option value="multiply">Multiplicação</option>
                <option value="screen">Divisão</option>
                <option value="overlay">Sobrepor</option>
                <option value="lighten">Clarear</option>
                <option value="darken">Escurecer</option>
              </select>
            </label>
            <label>
              Ângulo
              <span class="layer-style-number">
                <input
                  :value="innerShadowAngle"
                  max="180"
                  min="-180"
                  step="1"
                  type="number"
                  @input="updateInnerShadowAngle(Number(($event.target as HTMLInputElement).value))"
                />
                <span aria-hidden="true">°</span>
              </span>
            </label>
            <label class="layer-style-preview-toggle">
              <input
                :checked="innerShadowSettings.useGlobalLight"
                type="checkbox"
                @change="updateInnerShadow({ useGlobalLight: ($event.target as HTMLInputElement).checked })"
              />
              <span>Usar luz global</span>
            </label>
          </div>

          <div class="layer-style-slider-list">
            <label v-for="control in [
              { key: 'opacity', label: 'Opacidade', value: innerShadowSettings.opacity, max: 100, suffix: '%' },
              { key: 'distance', label: 'Distância', value: innerShadowSettings.distance, max: 1000, suffix: 'px' },
              { key: 'choke', label: 'Dureza', value: innerShadowSettings.choke, max: 100, suffix: '%' },
              { key: 'size', label: 'Tamanho', value: innerShadowSettings.size, max: 250, suffix: 'px' },
              { key: 'noise', label: 'Ruído', value: innerShadowSettings.noise, max: 100, suffix: '%' }
            ]" :key="control.key" class="layer-style-parameter">
              <span>{{ control.label }}</span>
              <input
                :value="control.value"
                :max="control.max"
                min="0"
                type="range"
                @input="updateInnerShadow({ [control.key]: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="layer-style-parameter-value">
                <input
                  :value="control.value"
                  :max="control.max"
                  min="0"
                  type="number"
                  @input="updateInnerShadow({ [control.key]: Number(($event.target as HTMLInputElement).value) })"
                />
                <span aria-hidden="true">{{ control.suffix }}</span>
              </span>
            </label>
          </div>

          <label class="layer-style-contour">
            <span>Contorno</span>
            <select
              :value="innerShadowSettings.contour.preset"
              @change="updateInnerShadow({ contour: { ...innerShadowSettings.contour, preset: ($event.target as HTMLSelectElement).value as InnerShadowEffect['contour']['preset'] } })"
            >
              <option value="linear">Linear</option>
              <option value="gaussian">Gaussiano</option>
              <option value="cone">Cone</option>
              <option value="inverted-cone">Cone invertido</option>
              <option value="ring">Anel</option>
            </select>
          </label>
        </div>

        <div v-else-if="selectedCategory === 'outer-glow'" class="layer-style-controls layer-style-controls--scrollable">
          <h3>Brilho externo</h3>
          <div class="layer-style-grid">
            <label>
              Preenchimento
              <select :value="outerGlowSettings.paint.type" @change="setOuterGlowPaint(($event.target as HTMLSelectElement).value as 'color' | 'gradient')">
                <option value="color">Cor</option>
                <option value="gradient">Gradiente</option>
              </select>
            </label>
            <label>
              {{ outerGlowSettings.paint.type === 'gradient' ? 'Cor inicial' : 'Cor' }}
              <input
                class="layer-style-color"
                :value="outerGlowColor"
                type="color"
                @input="outerGlowSettings.paint.type === 'gradient'
                  ? updateGradientColor(0, ($event.target as HTMLInputElement).value)
                  : updateOuterGlow({ paint: { type: 'color', color: ($event.target as HTMLInputElement).value } })"
              />
            </label>
            <label v-if="outerGlowSettings.paint.type === 'gradient'">
              Cor final
              <input
                class="layer-style-color"
                :value="outerGlowGradientEnd"
                type="color"
                @input="updateGradientColor(1, ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              Técnica
              <select
                :value="outerGlowSettings.technique"
                @change="updateOuterGlow({ technique: ($event.target as HTMLSelectElement).value as OuterGlowEffect['technique'] })"
              >
                <option value="softer">Suave</option>
                <option value="precise">Precisa</option>
              </select>
            </label>
            <label>
              Modo
              <select
                :value="outerGlowSettings.blendMode"
                @change="updateOuterGlow({ blendMode: ($event.target as HTMLSelectElement).value as OuterGlowEffect['blendMode'] })"
              >
                <option value="normal">Normal</option>
                <option value="screen">Divisão</option>
                <option value="multiply">Multiplicação</option>
                <option value="overlay">Sobrepor</option>
                <option value="lighten">Clarear</option>
                <option value="darken">Escurecer</option>
              </select>
            </label>
          </div>

          <div class="layer-style-slider-list">
            <label v-for="control in [
              { key: 'opacity', label: 'Opacidade', value: outerGlowSettings.opacity, max: 100, suffix: '%' },
              { key: 'spread', label: 'Expansão', value: outerGlowSettings.spread, max: 100, suffix: '%' },
              { key: 'size', label: 'Tamanho', value: outerGlowSettings.size, max: 250, suffix: 'px' },
              { key: 'noise', label: 'Ruído', value: outerGlowSettings.noise, max: 100, suffix: '%' },
              { key: 'range', label: 'Intervalo', value: outerGlowSettings.range, max: 100, suffix: '%' },
              { key: 'jitter', label: 'Tremulação', value: outerGlowSettings.jitter, max: 100, suffix: '%' }
            ]" :key="control.key" class="layer-style-parameter">
              <span>{{ control.label }}</span>
              <input
                :value="control.value"
                :max="control.max"
                :min="control.key === 'range' ? 1 : 0"
                type="range"
                @input="updateOuterGlow({ [control.key]: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="layer-style-parameter-value">
                <input
                  :value="control.value"
                  :max="control.max"
                  :min="control.key === 'range' ? 1 : 0"
                  type="number"
                  @input="updateOuterGlow({ [control.key]: Number(($event.target as HTMLInputElement).value) })"
                />
                <span aria-hidden="true">{{ control.suffix }}</span>
              </span>
            </label>
          </div>

          <label class="layer-style-contour">
            <span>Contorno</span>
            <select
              :value="outerGlowSettings.contour.preset"
              @change="updateOuterGlow({ contour: { ...outerGlowSettings.contour, preset: ($event.target as HTMLSelectElement).value as OuterGlowEffect['contour']['preset'] } })"
            >
              <option value="linear">Linear</option>
              <option value="gaussian">Gaussiano</option>
              <option value="cone">Cone</option>
              <option value="inverted-cone">Cone invertido</option>
              <option value="ring">Anel</option>
            </select>
          </label>
        </div>

        <div v-else-if="selectedCategory === 'inner-glow'" class="layer-style-controls layer-style-controls--scrollable">
          <h3>Brilho interno</h3>
          <div class="layer-style-grid">
            <label>
              Origem
              <select
                :value="innerGlowSettings.source"
                @change="updateInnerGlow({ source: ($event.target as HTMLSelectElement).value as InnerGlowEffect['source'] })"
              >
                <option value="edge">Borda</option>
                <option value="center">Centro</option>
              </select>
            </label>
            <label>
              Preenchimento
              <select :value="innerGlowSettings.paint.type" @change="setInnerGlowPaint(($event.target as HTMLSelectElement).value as 'color' | 'gradient')">
                <option value="color">Cor</option>
                <option value="gradient">Gradiente</option>
              </select>
            </label>
            <label>
              {{ innerGlowSettings.paint.type === 'gradient' ? 'Cor inicial' : 'Cor' }}
              <input
                class="layer-style-color"
                :value="innerGlowColor"
                type="color"
                @input="innerGlowSettings.paint.type === 'gradient'
                  ? updateInnerGradientColor(0, ($event.target as HTMLInputElement).value)
                  : updateInnerGlow({ paint: { type: 'color', color: ($event.target as HTMLInputElement).value } })"
              />
            </label>
            <label v-if="innerGlowSettings.paint.type === 'gradient'">
              Cor final
              <input
                class="layer-style-color"
                :value="innerGlowGradientEnd"
                type="color"
                @input="updateInnerGradientColor(1, ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              Técnica
              <select
                :value="innerGlowSettings.technique"
                @change="updateInnerGlow({ technique: ($event.target as HTMLSelectElement).value as InnerGlowEffect['technique'] })"
              >
                <option value="softer">Suave</option>
                <option value="precise">Precisa</option>
              </select>
            </label>
            <label>
              Modo
              <select
                :value="innerGlowSettings.blendMode"
                @change="updateInnerGlow({ blendMode: ($event.target as HTMLSelectElement).value as InnerGlowEffect['blendMode'] })"
              >
                <option value="normal">Normal</option>
                <option value="screen">Divisão</option>
                <option value="multiply">Multiplicação</option>
                <option value="overlay">Sobrepor</option>
                <option value="lighten">Clarear</option>
                <option value="darken">Escurecer</option>
              </select>
            </label>
          </div>

          <div class="layer-style-slider-list">
            <label v-for="control in [
              { key: 'opacity', label: 'Opacidade', value: innerGlowSettings.opacity, max: 100, suffix: '%' },
              { key: 'choke', label: 'Dureza', value: innerGlowSettings.choke, max: 100, suffix: '%' },
              { key: 'size', label: 'Tamanho', value: innerGlowSettings.size, max: 250, suffix: 'px' },
              { key: 'noise', label: 'Ruído', value: innerGlowSettings.noise, max: 100, suffix: '%' },
              { key: 'range', label: 'Intervalo', value: innerGlowSettings.range, max: 100, suffix: '%' },
              { key: 'jitter', label: 'Tremulação', value: innerGlowSettings.jitter, max: 100, suffix: '%' }
            ]" :key="control.key" class="layer-style-parameter">
              <span>{{ control.label }}</span>
              <input
                :value="control.value"
                :max="control.max"
                :min="control.key === 'range' ? 1 : 0"
                type="range"
                @input="updateInnerGlow({ [control.key]: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="layer-style-parameter-value">
                <input
                  :value="control.value"
                  :max="control.max"
                  :min="control.key === 'range' ? 1 : 0"
                  type="number"
                  @input="updateInnerGlow({ [control.key]: Number(($event.target as HTMLInputElement).value) })"
                />
                <span aria-hidden="true">{{ control.suffix }}</span>
              </span>
            </label>
          </div>

          <label class="layer-style-contour">
            <span>Contorno</span>
            <select
              :value="innerGlowSettings.contour.preset"
              @change="updateInnerGlow({ contour: { ...innerGlowSettings.contour, preset: ($event.target as HTMLSelectElement).value as InnerGlowEffect['contour']['preset'] } })"
            >
              <option value="linear">Linear</option>
              <option value="gaussian">Gaussiano</option>
              <option value="cone">Cone</option>
              <option value="inverted-cone">Cone invertido</option>
              <option value="ring">Anel</option>
            </select>
          </label>
        </div>

        <div v-else-if="selectedCategory === 'stroke'" class="layer-style-controls layer-style-controls--scrollable">
          <h3>Traçado</h3>
          <div class="layer-style-grid">
            <label>
              Posição
              <select
                :value="strokeSettings.position"
                @change="updateStroke({ position: ($event.target as HTMLSelectElement).value as StrokeEffect['position'] })"
              >
                <option value="inside">Interna</option>
                <option value="center">Central</option>
                <option value="outside">Externa</option>
              </select>
            </label>
            <label>
              Preenchimento
              <select :value="strokeSettings.paint.type" @change="setStrokePaint(($event.target as HTMLSelectElement).value as 'color' | 'gradient' | 'pattern')">
                <option value="color">Cor</option>
                <option value="gradient">Gradiente</option>
                <option value="pattern">Padrão</option>
              </select>
            </label>
            <LayerStylePatternPicker
              v-if="strokeSettings.paint.type === 'pattern'"
              :pattern="strokeSettings.paint.pattern"
              @select="updateStrokePattern"
            />
            <label v-else>
              {{ strokeSettings.paint.type === 'gradient' ? 'Cor inicial' : 'Cor' }}
              <input
                class="layer-style-color"
                :value="strokeColor"
                type="color"
                @input="strokeSettings.paint.type === 'gradient'
                  ? updateStrokeGradientColor(0, ($event.target as HTMLInputElement).value)
                  : updateStroke({ paint: { type: 'color', color: ($event.target as HTMLInputElement).value } })"
              />
            </label>
            <label v-if="strokeSettings.paint.type === 'gradient'">
              Cor final
              <input
                class="layer-style-color"
                :value="strokeGradientEnd"
                type="color"
                @input="updateStrokeGradientColor(1, ($event.target as HTMLInputElement).value)"
              />
            </label>
            <label>
              Modo
              <select
                :value="strokeSettings.blendMode"
                @change="updateStroke({ blendMode: ($event.target as HTMLSelectElement).value as StrokeEffect['blendMode'] })"
              >
                <option value="normal">Normal</option>
                <option value="multiply">Multiplicação</option>
                <option value="screen">Divisão</option>
                <option value="overlay">Sobrepor</option>
                <option value="lighten">Clarear</option>
                <option value="darken">Escurecer</option>
              </select>
            </label>
            <label v-if="strokeSettings.paint.type === 'gradient'">
              Tipo de gradiente
              <select
                :value="strokeSettings.paint.gradient.type"
                @change="updateStrokeGradient({ type: ($event.target as HTMLSelectElement).value as LayerStyleGradient['type'] })"
              >
                <option value="linear">Linear</option>
                <option value="radial">Radial</option>
                <option value="angle">Angular</option>
                <option value="reflected">Refletido</option>
                <option value="diamond">Diamante</option>
              </select>
            </label>
            <label v-if="strokeSettings.paint.type === 'gradient'">
              Ângulo
              <span class="layer-style-number">
                <input
                  :value="strokeSettings.paint.angle"
                  max="180"
                  min="-180"
                  type="number"
                  @input="updateStrokeGradientOptions({ angle: Number(($event.target as HTMLInputElement).value) })"
                />
                <span aria-hidden="true">°</span>
              </span>
            </label>
            <label v-if="strokeSettings.paint.type === 'pattern'">
              Ângulo
              <span class="layer-style-number">
                <input
                  :value="strokeSettings.paint.angle"
                  max="180"
                  min="-180"
                  type="number"
                  @input="updateStrokePatternOptions({ angle: Number(($event.target as HTMLInputElement).value) })"
                />
                <span aria-hidden="true">°</span>
              </span>
            </label>
            <label v-if="strokeSettings.paint.type === 'gradient'" class="layer-style-preview-toggle">
              <input
                :checked="strokeSettings.paint.reverse"
                type="checkbox"
                @change="updateStrokeGradientOptions({ reverse: ($event.target as HTMLInputElement).checked })"
              />
              <span>Inverter gradiente</span>
            </label>
          </div>

          <div class="layer-style-slider-list">
            <label v-for="control in [
              { key: 'opacity', label: 'Opacidade', value: strokeSettings.opacity, max: 100, min: 0, suffix: '%' },
              { key: 'size', label: 'Tamanho', value: strokeSettings.size, max: 250, min: 1, suffix: 'px' }
            ]" :key="control.key" class="layer-style-parameter">
              <span>{{ control.label }}</span>
              <input
                :value="control.value"
                :max="control.max"
                :min="control.min"
                type="range"
                @input="updateStroke({ [control.key]: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="layer-style-parameter-value">
                <input
                  :value="control.value"
                  :max="control.max"
                  :min="control.min"
                  type="number"
                  @input="updateStroke({ [control.key]: Number(($event.target as HTMLInputElement).value) })"
                />
                <span aria-hidden="true">{{ control.suffix }}</span>
              </span>
            </label>
            <label v-if="strokeSettings.paint.type === 'gradient'" class="layer-style-parameter">
              <span>Escala</span>
              <input
                :value="strokeSettings.paint.scale"
                max="1000"
                min="1"
                type="range"
                @input="updateStrokeGradientOptions({ scale: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="layer-style-parameter-value">
                <input
                  :value="strokeSettings.paint.scale"
                  max="1000"
                  min="1"
                  type="number"
                  @input="updateStrokeGradientOptions({ scale: Number(($event.target as HTMLInputElement).value) })"
                />
                <span aria-hidden="true">%</span>
              </span>
            </label>
            <label v-if="strokeSettings.paint.type === 'pattern'" class="layer-style-parameter">
              <span>Escala</span>
              <input
                :value="strokeSettings.paint.scale"
                max="1000"
                min="1"
                type="range"
                @input="updateStrokePatternOptions({ scale: Number(($event.target as HTMLInputElement).value) })"
              />
              <span class="layer-style-parameter-value">
                <input
                  :value="strokeSettings.paint.scale"
                  max="1000"
                  min="1"
                  type="number"
                  @input="updateStrokePatternOptions({ scale: Number(($event.target as HTMLInputElement).value) })"
                />
                <span aria-hidden="true">%</span>
              </span>
            </label>
          </div>
        </div>
        <LayerStyleColorOverlayControls
          v-else-if="selectedCategory === 'color-overlay'"
          :effect="colorOverlaySettings"
          @update="updateColorOverlay"
        />
        <LayerStyleGradientOverlayControls
          v-else-if="selectedCategory === 'gradient-overlay'"
          :effect="gradientOverlaySettings"
          @update="updateGradientOverlay"
        />
        <LayerStylePatternOverlayControls
          v-else-if="selectedCategory === 'pattern-overlay'"
          :effect="patternOverlaySettings"
          @update="updatePatternOverlay"
        />
        <LayerStyleSatinControls
          v-else-if="selectedCategory === 'satin'"
          :effect="satinSettings"
          @update="updateSatin"
        />
        <LayerStyleBevelEmbossControls
          v-else
          :effect="bevelEmbossSettings"
          :global-light="draftGlobalLight"
          @update="updateBevelEmboss"
          @update-angle="updateBevelEmbossAngle"
          @select-texture="selectBevelEmbossTexture"
        />
      </div>

      <footer class="layer-style-footer">
        <button type="button" @click="restoreDefault">Restaurar padrão</button>
        <label class="layer-style-preview-toggle">
          <input :checked="previewEnabled" type="checkbox" @change="togglePreview" />
          <span>Visualizar</span>
        </label>
        <div class="dialog-actions">
          <button type="button" @click="cancelDialog">Cancelar</button>
          <button class="primary-button" type="button" @click="applyDialog">OK</button>
        </div>
      </footer>
      <span
        class="layer-style-resize-handle layer-style-resize-handle--north-west"
        aria-hidden="true"
        @pointerdown="beginResize($event, 'north-west')"
      ></span>
      <span
        class="layer-style-resize-handle layer-style-resize-handle--north-east"
        aria-hidden="true"
        @pointerdown="beginResize($event, 'north-east')"
      ></span>
      <span
        class="layer-style-resize-handle layer-style-resize-handle--south-west"
        aria-hidden="true"
        @pointerdown="beginResize($event, 'south-west')"
      ></span>
      <span
        class="layer-style-resize-handle layer-style-resize-handle--south-east"
        aria-hidden="true"
        @pointerdown="beginResize($event, 'south-east')"
      ></span>
    </section>
  </div>
</template>
