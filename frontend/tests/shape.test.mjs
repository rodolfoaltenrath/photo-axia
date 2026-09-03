import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_SHAPE_CONFIG,
  normalizeShapeConfig,
  reanchorShapeDrag,
  shapeGeometryFromDrag,
  shapeIsDegenerate,
  shapePathData,
  starVertices,
  superellipseVertices,
  traceShapePath,
  triangleVertices
} from '../src/editor/shape.ts'

test('normaliza a caixa nos quatro sentidos e combina Shift com Alt', () => {
  assert.deepEqual(shapeGeometryFromDrag({ x: 20, y: 30 }, { x: 5, y: 10 }), {
    x: 5, y: 10, width: 15, height: 20
  })
  assert.deepEqual(shapeGeometryFromDrag({ x: 20, y: 30 }, { x: 30, y: 35 }, true), {
    x: 20, y: 30, width: 10, height: 10
  })
  assert.deepEqual(shapeGeometryFromDrag({ x: 20, y: 30 }, { x: 30, y: 35 }, true, true), {
    x: 10, y: 20, width: 20, height: 20
  })
})

test('gera um caminho SVG vetorial reutilizável sem rasterizar a forma', () => {
  const path = shapePathData({ x: 0, y: 0, width: 120, height: 80 }, {
    ...DEFAULT_SHAPE_CONFIG,
    cornerRadius: 12
  })
  assert.match(path, /^M /)
  assert.match(path, /Q /)
  assert.match(path, /Z$/)
  assert.equal(path.includes('NaN'), false)
})

test('alternar Alt durante o arraste preserva a geometria antes de continuar pelo centro', () => {
  const geometry = shapeGeometryFromDrag({ x: 20, y: 30 }, { x: 80, y: 70 })
  const centered = reanchorShapeDrag(geometry, { x: 80, y: 70 }, true)
  assert.deepEqual(shapeGeometryFromDrag(centered.start, centered.end, false, true), geometry)

  const corner = reanchorShapeDrag(geometry, centered.end, false)
  assert.deepEqual(shapeGeometryFromDrag(corner.start, corner.end), geometry)
})

test('normaliza configurações adulteradas sem perder defaults acessíveis', () => {
  assert.deepEqual(normalizeShapeConfig({
    ...DEFAULT_SHAPE_CONFIG,
    kind: /** @type {never} */ ('hexagon'),
    color: 'red',
    cornerRadius: -10,
    squareness: 200,
    starPoints: 90,
    starInnerRatio: 0
  }), {
    kind: 'rectangle', color: '#000000', cornerRadius: 0, squareness: 100, starPoints: 32, starInnerRatio: 5
  })
})

test('triângulo ocupa a caixa e aponta para cima', () => {
  assert.deepEqual(triangleVertices({ x: 10, y: 20, width: 100, height: 80 }), [
    { x: 60, y: 20 }, { x: 110, y: 100 }, { x: 10, y: 100 }
  ])
})

test('estrela alterna raios e respeita quantidade de pontas', () => {
  const vertices = starVertices({ x: 0, y: 0, width: 100, height: 100 }, 5, 50)
  assert.equal(vertices.length, 10)
  assert.ok(Math.abs(vertices[0].x - 50) < 1e-9)
  assert.ok(Math.abs(vertices[0].y) < 1e-9)
  assert.ok(Math.hypot(vertices[1].x - 50, vertices[1].y - 50) < 50)
})

test('quadratura aproxima a elipse dos cantos sem ultrapassar a caixa', () => {
  const ellipse = superellipseVertices({ x: 0, y: 0, width: 100, height: 60 }, 0, 64)
  const squared = superellipseVertices({ x: 0, y: 0, width: 100, height: 60 }, 100, 64)
  assert.equal(ellipse.length, 64)
  assert.ok(squared[8].x > ellipse[8].x)
  assert.ok(squared[8].y > ellipse[8].y)
  for (const point of squared) {
    assert.ok(point.x >= 0 && point.x <= 100)
    assert.ok(point.y >= 0 && point.y <= 60)
  }
})

test('recusa gestos subpixel ou inválidos', () => {
  assert.equal(shapeIsDegenerate({ x: 0, y: 0, width: 0.49, height: 10 }), true)
  assert.equal(shapeIsDegenerate({ x: 0, y: 0, width: 10, height: 10 }), false)
})

test('traça todas as formas com comandos finitos e limita raios exagerados', () => {
  for (const kind of ['rectangle', 'ellipse', 'triangle', 'star']) {
    const coordinates = []
    const context = {
      beginPath() {}, closePath() {},
      lineTo(...values) { coordinates.push(...values) },
      moveTo(...values) { coordinates.push(...values) },
      quadraticCurveTo(...values) { coordinates.push(...values) }
    }
    traceShapePath(context, { x: 10, y: 20, width: 8, height: 6 }, {
      ...DEFAULT_SHAPE_CONFIG, kind, cornerRadius: 10_000, squareness: 100, starPoints: 32
    })
    assert.ok(coordinates.length > 0)
    assert.ok(coordinates.every(Number.isFinite))
    assert.ok(coordinates.every((value, index) => index % 2 ? value >= 20 && value <= 26 : value >= 10 && value <= 18))
  }
})
