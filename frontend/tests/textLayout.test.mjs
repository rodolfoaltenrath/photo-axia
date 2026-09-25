import test from 'node:test'
import assert from 'node:assert/strict'
import { layoutTextLines, measureTextLayer, textDisplayContent, textLayoutMode, textLines } from '../src/editor/text.ts'

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
  const text = {
    content: 'aa bb cc', fontFamily: 'sans-serif', fontSize: 10, fontWeight: 400,
    color: '#fff', alignment: 'left', lineHeight: 1, baseWidth: 18, baseHeight: 1,
    layoutMode: 'paragraph', letterSpacing: 0
  }
  assert.deepEqual(layoutTextLines(text, null), ['aa', 'bb', 'cc'])
  assert.deepEqual(measureTextLayer(text), { width: 18, height: 30 })
})

test('caixa alta altera apenas a apresentação, não o conteúdo persistido', () => {
  assert.equal(textDisplayContent({ content: 'Axia ç', textTransform: 'uppercase' }), 'AXIA Ç')
})
