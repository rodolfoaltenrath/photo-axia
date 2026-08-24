import assert from 'node:assert/strict'
import test from 'node:test'
import { computed } from 'vue'
import {
  applyGroupMove,
  applyGroupResize,
  applyGroupRotate,
  groupBoundsFromRects
} from '../src/editor/groupTransform.ts'
import { createTransformSessionRef } from '../src/components/canvas/composables/useFreeTransform.ts'

function approxEqual(actual, expected, tolerance = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `esperado ${actual} próximo de ${expected}`
  )
}

test('caixa de grupo com uma camada reproduz o retângulo original, com rotação', () => {
  const rect = { x: 10, y: 20, width: 100, height: 50, rotation: 25 }
  assert.deepEqual(groupBoundsFromRects([rect]), rect)
})

test('caixa de grupo com várias camadas é a união alinhada ao eixo, sempre com rotação zero', () => {
  const bounds = groupBoundsFromRects([
    { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    { x: 200, y: 50, width: 50, height: 50, rotation: 0 }
  ])
  assert.deepEqual(bounds, { x: 0, y: 0, width: 250, height: 100, rotation: 0 })
})

test('mover o grupo desloca cada camada preservando tamanho e rotação individuais', () => {
  const memberStarts = {
    a: { x: 0, y: 0, width: 100, height: 100, rotation: 0 },
    b: { x: 200, y: 50, width: 50, height: 50, rotation: 15 }
  }
  const groupStart = { x: 0, y: 0, width: 250, height: 100, rotation: 0 }
  const groupDraft = { x: 30, y: -10, width: 250, height: 100, rotation: 0 }
  const drafts = applyGroupMove(['a', 'b'], memberStarts, groupStart, groupDraft)
  assert.deepEqual(drafts.a, { x: 30, y: -10, width: 100, height: 100, rotation: 0 })
  assert.deepEqual(drafts.b, { x: 230, y: 40, width: 50, height: 50, rotation: 15 })
})

test('redimensionar o grupo escala a posição e o tamanho de cada camada proporcionalmente', () => {
  const memberStarts = {
    a: { x: 0, y: 0, width: 20, height: 20, rotation: 0 },
    b: { x: 80, y: 80, width: 20, height: 20, rotation: 0 }
  }
  const groupStart = { x: 0, y: 0, width: 100, height: 100, rotation: 0 }
  const groupDraft = { x: 0, y: 0, width: 200, height: 200, rotation: 0 }
  const drafts = applyGroupResize(['a', 'b'], memberStarts, groupStart, groupDraft)
  assert.deepEqual(drafts.a, { x: 0, y: 0, width: 40, height: 40, rotation: 0 })
  assert.deepEqual(drafts.b, { x: 160, y: 160, width: 40, height: 40, rotation: 0 })
})

test('redimensionar um grupo já rotacionado não produz NaN e mantém a proporção entre camadas', () => {
  const memberStarts = {
    a: { x: 0, y: 0, width: 20, height: 20, rotation: 0 },
    b: { x: 80, y: 80, width: 20, height: 20, rotation: 10 }
  }
  const groupStart = { x: 0, y: 0, width: 100, height: 100, rotation: 40 }
  const groupDraft = { x: 0, y: 0, width: 150, height: 150, rotation: 40 }
  const drafts = applyGroupResize(['a', 'b'], memberStarts, groupStart, groupDraft)
  for (const draft of Object.values(drafts)) {
    for (const value of [draft.x, draft.y, draft.width, draft.height]) {
      assert.ok(Number.isFinite(value), `valor não finito: ${value}`)
    }
  }
  approxEqual(drafts.a.width, 30)
  approxEqual(drafts.b.width, 30)
  assert.equal(drafts.b.rotation, 10)
})

test('caixa de grupo com largura zero não gera NaN ao redimensionar (guarda contra divisão por zero)', () => {
  const memberStarts = {
    a: { x: 50, y: 0, width: 0, height: 100, rotation: 0 }
  }
  const groupStart = { x: 50, y: 0, width: 0, height: 100, rotation: 0 }
  const groupDraft = { x: 40, y: 0, width: 20, height: 100, rotation: 0 }
  const drafts = applyGroupResize(['a', 'b-ausente'], memberStarts, groupStart, groupDraft)
  assert.ok(Number.isFinite(drafts.a.x))
  assert.ok(Number.isFinite(drafts.a.width))
})

test('girar o grupo gira o centro de cada camada ao redor do centro do grupo e soma a rotação própria', () => {
  const memberStarts = {
    a: { x: 0, y: 0, width: 20, height: 20, rotation: 0 },
    b: { x: 80, y: 0, width: 20, height: 20, rotation: 5 }
  }
  const groupStart = { x: 0, y: 0, width: 100, height: 20, rotation: 0 }
  const groupDraft = { x: 0, y: 0, width: 100, height: 20, rotation: 90 }
  const drafts = applyGroupRotate(['a', 'b'], memberStarts, groupStart, groupDraft)
  // O centro do grupo é (50,10). O centro da camada "a" (10,10) está 40 à
  // esquerda do centro do grupo; girando 90° no sentido horário (convenção de
  // tela, eixo Y para baixo) esse deslocamento vira 40 acima do centro, então
  // o novo centro de "a" é (50, -30).
  approxEqual(drafts.a.x + drafts.a.width / 2, 50)
  approxEqual(drafts.a.y + drafts.a.height / 2, -30)
  assert.equal(drafts.a.rotation, 90)
  assert.equal(drafts.b.rotation, 95)
})

test('encadear redimensionar e depois mover na mesma sessão preserva o tamanho redimensionado', () => {
  // Reproduz o fluxo: seleciona 2 camadas, arrasta um canto para redimensionar,
  // solta, e sem fechar o Ctrl+T arrasta o corpo para mover. A segunda
  // interação deve partir do resultado da primeira, não do início da sessão.
  const sessionOriginal = {
    a: { x: 0, y: 0, width: 20, height: 20, rotation: 0 },
    b: { x: 80, y: 80, width: 20, height: 20, rotation: 0 }
  }
  const groupOriginal = { x: 0, y: 0, width: 100, height: 100, rotation: 0 }

  // Interação 1: redimensionar o grupo para o dobro.
  const resizeDraft = applyGroupResize(['a', 'b'], sessionOriginal, groupOriginal, {
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    rotation: 0
  })
  const groupAfterResize = { x: 0, y: 0, width: 200, height: 200, rotation: 0 }

  // Interação 2: mover o grupo já redimensionado, partindo do resultado da interação 1.
  const moveDraft = applyGroupMove(['a', 'b'], resizeDraft, groupAfterResize, {
    x: 30,
    y: 30,
    width: 200,
    height: 200,
    rotation: 0
  })

  // O tamanho ganho no redimensionamento não pode ter sido perdido pelo move.
  assert.deepEqual(moveDraft.a, { x: 30, y: 30, width: 40, height: 40, rotation: 0 })
  assert.deepEqual(moveDraft.b, { x: 190, y: 190, width: 40, height: 40, rotation: 0 })
})

test('a caixa do Ctrl+T reage ao draft interno antes do próximo gesto', () => {
  const session = createTransformSessionRef()
  session.value = {
    members: [],
    groupDraft: { x: 0, y: 0, width: 100, height: 50, rotation: 0 },
    drafts: {}
  }
  const selectorWidth = computed(() => session.value?.groupDraft.width)
  assert.equal(selectorWidth.value, 100)

  // Reproduz a alteração feita pelo primeiro arraste sem trocar a identidade
  // da sessão. O computed precisa enxergar 200 antes do pointerdown seguinte.
  session.value.groupDraft.width = 200
  assert.equal(selectorWidth.value, 200)
})
