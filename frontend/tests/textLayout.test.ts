import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ellipseTextPathData,
  layoutText,
  layoutTextLines,
  MAX_TEXT_CONTENT_LENGTH,
  MAX_TEXT_LINE_COUNT,
  measureTextLayer,
  resizeParagraphText,
  textContentIsWithinLimits,
  textDisplayContent,
  textLayoutMode,
  textPathDisplayContent,
  textPathMode,
  textPathOffset,
  textLines
} from '../src/editor/text.ts'
import { drawTextLayerContent, textPresentationScale, textStyleRasterPlan, textStyleRasterSource } from '../src/editor/textCanvas.ts'
import type { TextLayerContent } from '../src/types/editor.ts'

test('normaliza quebras de linha sem eliminar linhas vazias', () => {
  assert.deepEqual(textLines('Título\r\n\r\nSubtítulo'), ['Título', '', 'Subtítulo'])
})

test('texto de projetos antigos permanece no modo pontual', () => {
  assert.equal(textLayoutMode({}), 'point')
  assert.equal(textLayoutMode({ layoutMode: 'paragraph' }), 'paragraph')
})

test('medição possui fallback determinístico fora do DOM', () => {
  const size = measureTextLayer({
    content: 'A\nBC',
    fontFamily: 'sans-serif',
    fontSize: 20,
    fontWeight: 400,
    color: '#ffffff',
    alignment: 'left',
    lineHeight: 1.2,
    baseWidth: 1,
    baseHeight: 1,
    layoutMode: 'point'
  })
  assert.equal(size.width, 26)
  assert.equal(size.height, 48)
})

test('parágrafo preserva largura e quebra em limites de palavra', () => {
  const text: TextLayerContent = {
    content: 'aa bb cc', fontFamily: 'sans-serif', fontSize: 10, fontWeight: 400,
    color: '#fff', alignment: 'left', lineHeight: 1, baseWidth: 18, baseHeight: 1,
    layoutMode: 'paragraph', letterSpacing: 0
  }
  assert.deepEqual(layoutTextLines(text, null), ['aa', 'bb', 'cc'])
  assert.deepEqual(measureTextLayer(text), { width: 18, height: 30 })
})

test('layout calcula a posição horizontal de cada linha para todos os alinhamentos suportados', () => {
  const base: TextLayerContent = {
    content: 'aa\nb', fontFamily: 'sans-serif', fontSize: 10, fontWeight: 400,
    color: '#fff', alignment: 'left', lineHeight: 1, baseWidth: 30, baseHeight: 1,
    layoutMode: 'paragraph', letterSpacing: 0
  }
  assert.deepEqual(layoutText(base, null).lines.map(({ x, y }) => ({ x, y })), [
    { x: 0, y: 0 }, { x: 0, y: 10 }
  ])
  assert.deepEqual(layoutText({ ...base, alignment: 'center' }, null).lines.map(({ x, y }) => ({ x, y })), [
    { x: 9, y: 0 }, { x: 12, y: 10 }
  ])
  assert.deepEqual(layoutText({ ...base, alignment: 'right' }, null).lines.map(({ x, y }) => ({ x, y })), [
    { x: 18, y: 0 }, { x: 24, y: 10 }
  ])
})

test('caixa alta altera apenas a apresentação, não o conteúdo persistido', () => {
  assert.equal(textDisplayContent({ content: 'Axia ç', textTransform: 'uppercase' }), 'AXIA Ç')
})

test('trajetória elíptica mantém o texto editável em uma única linha visual', () => {
  const text: TextLayerContent = {
    content: 'Axia\nStudio', fontFamily: 'sans-serif', fontSize: 24, fontWeight: 400,
    color: '#fff', alignment: 'center', lineHeight: 1.2, baseWidth: 240, baseHeight: 150,
    pathMode: 'ellipse', pathOffset: 45
  }
  assert.equal(textPathMode(text), 'ellipse')
  assert.equal(textPathMode({}), 'none')
  assert.equal(textPathOffset({ pathOffset: 999 }), 360)
  assert.equal(textPathDisplayContent(text), 'Axia Studio')
  assert.match(ellipseTextPathData(text), /^M 120 /)
  assert.deepEqual(measureTextLayer(text), { width: 240, height: 150 })
})

test('desenhador Canvas posiciona os glifos de uma trajetória sem rasterizar a camada', () => {
  const calls: string[] = []
  const context = {
    save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, fillRect() {},
    measureText(value: string) { return { width: value.length * 12 } },
    fillText(value: string) { calls.push(value) },
    set fillStyle(_value: string) {}, set font(_value: string) {},
    set textAlign(_value: string) {}, set textBaseline(_value: string) {},
    set letterSpacing(_value: string) {}
  } as unknown as CanvasRenderingContext2D
  drawTextLayerContent(context, {
    content: 'ABC', fontFamily: 'sans-serif', fontSize: 20, fontWeight: 400,
    color: '#fff', alignment: 'center', lineHeight: 1.2, baseWidth: 200, baseHeight: 120,
    pathMode: 'ellipse', pathOffset: 0
  })
  assert.deepEqual(calls, ['A', 'B', 'C'])
})

test('aceita Unicode e rejeita conteúdo que ultrapassa os limites seguros', () => {
  assert.equal(textContentIsWithinLimits('Olá 👋\r\nمرحبا\r\n世界'), true)
  assert.equal(textContentIsWithinLimits('a'.repeat(MAX_TEXT_CONTENT_LENGTH + 1)), false)
  assert.equal(textContentIsWithinLimits(Array(MAX_TEXT_LINE_COUNT + 2).fill('a').join('\n')), false)
})

test('redimensionar parágrafo recompõe linhas sem alterar tamanho dos glifos', () => {
  const source: TextLayerContent = {
    content: 'aa bb cc dd', fontFamily: 'sans-serif', fontSize: 10, fontWeight: 400,
    color: '#fff', alignment: 'left', lineHeight: 1, baseWidth: 60, baseHeight: 10,
    layoutMode: 'paragraph'
  }
  const resized = resizeParagraphText(source, 18)
  assert.equal(resized.fontSize, source.fontSize)
  assert.equal(resized.baseWidth, 18)
  assert.equal(resized.baseHeight, 40)
  assert.deepEqual(layoutTextLines(resized, null), ['aa', 'bb', 'cc', 'dd'])
})

test('raster temporário acompanha a geometria do texto sem escalar o efeito em pixels', () => {
  const text = {
    content: 'Axia', fontFamily: 'sans-serif', fontSize: 40, fontWeight: 400,
    color: '#fff', alignment: 'left' as const, lineHeight: 1.2, baseWidth: 200, baseHeight: 60,
    layoutMode: 'point' as const
  }
  const initial = textStyleRasterPlan(text, { width: 200, height: 60 }, 2)
  const enlarged = textStyleRasterPlan(text, { width: 800, height: 240 }, 2)

  assert.deepEqual({ width: initial.width, height: initial.height, effectScale: initial.effectScale }, {
    width: 400, height: 120, effectScale: 2
  })
  assert.deepEqual({ width: enlarged.width, height: enlarged.height, effectScale: enlarged.effectScale }, {
    width: 1600, height: 480, effectScale: 2
  })
  assert.equal(enlarged.drawScaleX, initial.drawScaleX * 4)
  assert.equal(enlarged.drawScaleY, initial.drawScaleY * 4)
})

test('raster temporário de texto reduz a densidade antes de exceder o orçamento', () => {
  const plan = textStyleRasterPlan({ baseWidth: 1, baseHeight: 1 }, { width: 8_000, height: 8_000 }, 2)
  assert.ok(plan.width * plan.height <= 16_000_000)
  assert.ok(plan.effectScale < 1)
})

test('worker text source clones the text payload', () => {
  const text: TextLayerContent = {
    content: 'Axia', fontFamily: 'sans-serif', fontSize: 40, fontWeight: 400,
    color: '#fff', alignment: 'left', lineHeight: 1.2, baseWidth: 200, baseHeight: 60,
    layoutMode: 'point', pathMode: 'ellipse', pathOffset: 70
  }
  const plan = textStyleRasterPlan(text, { width: 400, height: 120 }, 2)
  const source = textStyleRasterSource(text, plan)

  text.content = 'changed later'
  assert.equal(source.type, 'text')
  assert.equal(source.text.content, 'Axia')
  assert.equal(source.text.pathMode, 'ellipse')
  assert.equal(source.text.pathOffset, 70)
  assert.equal(source.drawScaleX, 4)
  assert.equal(source.drawScaleY, 4)
})

test('apresenta texto DOM no tamanho final e limita transform Ã  correÃ§Ã£o horizontal', () => {
  assert.deepEqual(textPresentationScale(
    { baseWidth: 120, baseHeight: 60 },
    { width: 720, height: 360 }
  ), { scaleX: 6, scaleY: 6, horizontalCorrection: 1, renderScale: 1 })
  assert.deepEqual(textPresentationScale(
    { baseWidth: 120, baseHeight: 60 },
    { width: 720, height: 180 }
  ), { scaleX: 6, scaleY: 3, horizontalCorrection: 2, renderScale: 1 })
})

test('quantizes DOM text density for viewport zoom without exceeding the pixel budget', () => {
  assert.equal(textPresentationScale(
    { baseWidth: 120, baseHeight: 60 }, { width: 720, height: 360 }, 5.2
  ).renderScale, 6)
  assert.equal(textPresentationScale(
    { baseWidth: 120, baseHeight: 60 }, { width: 120, height: 60 }, 32
  ).renderScale, 32)
  assert.ok(textPresentationScale(
    { baseWidth: 120, baseHeight: 60 }, { width: 8_000, height: 8_000 }, 16
  ).renderScale < 2)
})
