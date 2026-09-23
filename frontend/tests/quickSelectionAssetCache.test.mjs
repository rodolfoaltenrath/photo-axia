import assert from 'node:assert/strict'
import test from 'node:test'
import { QuickSelectionAssetCache, quickSelectionAssetKey } from '../src/editor/quickSelectionAssetCache.ts'

const asset = (sourceUrl, editToken = 'v1') => ({
  sourceUrl, editToken, width: 10, height: 8, mimeType: 'image/png', byteSize: 320
})

test('identidade do raster inclui origem, revisão e dimensões', () => {
  assert.notEqual(quickSelectionAssetKey(asset('blob:a')), quickSelectionAssetKey(asset('blob:a', 'v2')))
  assert.notEqual(quickSelectionAssetKey(asset('blob:a')), quickSelectionAssetKey({ ...asset('blob:a'), width: 11 }))
})

test('reutiliza o blob enquanto a identidade do raster não muda', async () => {
  const cache = new QuickSelectionAssetCache()
  let loads = 0
  const load = async () => {
    loads++
    return new Blob(['pixels'])
  }
  const first = await cache.get(quickSelectionAssetKey(asset('blob:a')), load)
  const second = await cache.get(quickSelectionAssetKey(asset('blob:a')), load)
  assert.equal(loads, 1)
  assert.equal(first, second)
})

test('não publica carregamento antigo depois que a camada muda', async () => {
  const cache = new QuickSelectionAssetCache()
  let releaseOld
  const old = cache.get(quickSelectionAssetKey(asset('blob:a')), () => new Promise((resolve) => { releaseOld = resolve }))
  const newest = await cache.get(quickSelectionAssetKey(asset('blob:b')), async () => new Blob(['novo']))
  releaseOld(new Blob(['antigo']))
  await old
  const reused = await cache.get(quickSelectionAssetKey(asset('blob:b')), async () => new Blob(['erro']))
  assert.equal(reused, newest)
})
