import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addGradientStop,
  addGradientColorPoint,
  duplicateGradientColorPoint,
  gradientColorStopOpacity,
  gradientStripBackground,
  moveGradientStop,
  moveGradientColorPoint,
  removeGradientColorPoint,
  removeGradientStop,
  selectedGradientStop,
  storedGradientStopPosition,
  updateGradientStopValue,
  updateGradientColorPointOpacity,
  visualGradientStopPosition
} from '../src/editor/gradientEditor.ts'
import { threeStopTransparentGradientFixture } from './gradientStops.fixtures.ts'
import { thirtyTwoStopGradientFixture } from './gradientStops.fixtures.ts'
import type {
  GradientColorStop,
  GradientOpacityStop,
  GradientStopsConfig
} from '../src/editor/gradient.ts'
import type { GradientStopSelection } from '../src/editor/gradientEditor.ts'

function selectedColorStop(config: GradientStopsConfig, selection: GradientStopSelection): GradientColorStop {
  const stop = selectedGradientStop(config, selection)
  assert.ok(stop && 'color' in stop)
  return stop
}

function selectedOpacityStop(config: GradientStopsConfig, selection: GradientStopSelection): GradientOpacityStop {
  const stop = selectedGradientStop(config, selection)
  assert.ok(stop && 'opacity' in stop)
  return stop
}

function colorStop(config: GradientStopsConfig, id: string): GradientColorStop {
  const stop = config.colorStops.find((candidate) => candidate.id === id)
  assert.ok(stop)
  return stop
}

function opacityStop(config: GradientStopsConfig, id: string): GradientOpacityStop {
  const stop = config.opacityStops.find((candidate) => candidate.id === id)
  assert.ok(stop)
  return stop
}

test('adiciona cor e opacidade usando o valor interpolado no ponto clicado', () => {
  const color = addGradientStop(threeStopTransparentGradientFixture, 'color', 0.25)
  assert.equal(color.selection?.kind, 'color')
  assert.ok(color.selection)
  assert.equal(selectedColorStop(color.config, color.selection).color, '#808000')
  const opacity = addGradientStop(threeStopTransparentGradientFixture, 'opacity', 0.25)
  assert.ok(opacity.selection)
  assert.equal(selectedOpacityStop(opacity.config, opacity.selection).opacity, 50)
})

test('move no espaço visual corretamente quando o degradê está invertido', () => {
  const config = { ...threeStopTransparentGradientFixture, reversed: true }
  assert.equal(visualGradientStopPosition(config, 0.2), 0.8)
  assert.ok(Math.abs(storedGradientStopPosition(config, 0.8) - 0.2) < 1e-12)
  const moved = moveGradientStop(config, { kind: 'color', id: 'red' }, 0.7)
  assert.ok(Math.abs(colorStop(moved, 'red').position - 0.3) < 1e-12)
})

test('edita valores sem mutar a configuração anterior', () => {
  const colorSelection = { kind: 'color' as const, id: 'red' }
  const changedColor = updateGradientStopValue(threeStopTransparentGradientFixture, colorSelection, '#abcdef')
  assert.equal(selectedColorStop(changedColor, colorSelection).color, '#abcdef')
  assert.equal(selectedColorStop(threeStopTransparentGradientFixture, colorSelection).color, '#ff0000')
  const opacitySelection = { kind: 'opacity' as const, id: 'transparent-center' }
  const changedOpacity = updateGradientStopValue(threeStopTransparentGradientFixture, opacitySelection, 36)
  assert.equal(selectedOpacityStop(changedOpacity, opacitySelection).opacity, 36)
})

test('mantém ao menos dois pontos em cada trilha ao remover', () => {
  const removed = removeGradientStop(threeStopTransparentGradientFixture, { kind: 'color', id: 'green' })
  assert.equal(removed.colorStops.length, 2)
  const protectedConfig = removeGradientStop(removed, { kind: 'color', id: 'red' })
  assert.equal(protectedConfig.colorStops.length, 2)
})

test('gera faixa CSS amostrada com alfa visível', () => {
  const css = gradientStripBackground(threeStopTransparentGradientFixture, 5)
  assert.match(css, /^linear-gradient\(90deg,/)
  assert.match(css, /\/ 0\.000\) 50\.00%/)
})

test('recusa novos pontos ao atingir o limite da trilha', () => {
  const result = addGradientStop(thirtyTwoStopGradientFixture, 'color', 0.4)
  assert.equal(result.selection, null)
  assert.equal(result.config.colorStops.length, 32)
})

test('ponto unificado adiciona cor e transparência interpoladas na mesma posição', () => {
  const result = addGradientColorPoint(threeStopTransparentGradientFixture, 0.25)
  assert.ok(result.colorStopId)
  const color = colorStop(result.config, result.colorStopId)
  assert.equal(color.color, '#808000')
  assert.equal(color.position, 0.25)
  assert.equal(gradientColorStopOpacity(result.config, result.colorStopId), 50)
})

test('Alt duplica um ponto independente e mover leva sua transparência junto', () => {
  const duplicate = duplicateGradientColorPoint(threeStopTransparentGradientFixture, 'red')
  assert.ok(duplicate.colorStopId)
  assert.equal(duplicate.config.colorStops.length, 4)
  assert.equal(duplicate.config.opacityStops.length, 4)
  const moved = moveGradientColorPoint(duplicate.config, duplicate.colorStopId, 0.3)
  const color = colorStop(moved, duplicate.colorStopId)
  const opacity = opacityStop(moved, duplicate.colorStopId.replace('color-', 'opacity-'))
  assert.equal(color.position, 0.3)
  assert.equal(opacity.position, 0.3)
})

test('ponto unificado alterna transparência e remove o par sem afetar os demais', () => {
  const transparent = updateGradientColorPointOpacity(threeStopTransparentGradientFixture, 'green', 0)
  assert.equal(gradientColorStopOpacity(transparent, 'green'), 0)
  const visible = updateGradientColorPointOpacity(transparent, 'green', 100)
  assert.equal(gradientColorStopOpacity(visible, 'green'), 100)
  const removed = removeGradientColorPoint(visible, 'green')
  assert.equal(removed.colorStops.some((stop) => stop.id === 'green'), false)
  assert.equal(removed.colorStops.length, 2)
})

test('movimento unificado respeita inversão e não muta o snapshot anterior', () => {
  const source = {
    ...structuredClone(threeStopTransparentGradientFixture),
    reversed: true
  }
  const moved = moveGradientColorPoint(source, 'green', 0.25)
  assert.equal(colorStop(moved, 'green').position, 0.75)
  assert.equal(opacityStop(moved, 'transparent-center').position, 0.75)
  assert.equal(colorStop(source, 'green').position, 0.5)
})

test('ponto unificado respeita o limite formal de cores e opacidades', () => {
  const full = {
    ...thirtyTwoStopGradientFixture,
    opacityStops: thirtyTwoStopGradientFixture.colorStops.map((stop, index) => ({
      id: `opacity-${index}`,
      position: stop.position,
      opacity: 100
    }))
  }
  assert.equal(addGradientColorPoint(full, 0.4).colorStopId, null)
  assert.equal(duplicateGradientColorPoint(full, full.colorStops[0].id).colorStopId, null)
})
