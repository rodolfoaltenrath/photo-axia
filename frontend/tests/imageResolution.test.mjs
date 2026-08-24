import assert from 'node:assert/strict'
import test from 'node:test'
import { imageResolutionFromHeader } from '../src/editor/imageResolution.ts'

function pngWithPhys(xPixelsPerMeter, yPixelsPerMeter, unit = 1) {
  const bytes = new Uint8Array(8 + 12 + 9)
  const view = new DataView(bytes.buffer)
  view.setUint32(0, 0x89504e47)
  view.setUint32(4, 0x0d0a1a0a)
  view.setUint32(8, 9)
  view.setUint32(12, 0x70485973)
  view.setUint32(16, xPixelsPerMeter)
  view.setUint32(20, yPixelsPerMeter)
  view.setUint8(24, unit)
  return bytes.buffer
}

function jpegWithJfif(units, densityX, densityY) {
  const bytes = new Uint8Array(20)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0xffd8)
  view.setUint16(2, 0xffe0)
  view.setUint16(4, 16)
  view.setUint32(6, 0x4a464946)
  view.setUint8(10, 0)
  view.setUint16(11, 0x0102)
  view.setUint8(13, units)
  view.setUint16(14, densityX)
  view.setUint16(16, densityY)
  return bytes.buffer
}

function jpegWithExifResolution(densityX, densityY, unit = 2) {
  const bytes = new Uint8Array(82)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 0xffd8)
  view.setUint16(2, 0xffe1)
  view.setUint16(4, 76)
  view.setUint32(6, 0x45786966)
  view.setUint16(10, 0)
  const tiff = 12
  view.setUint16(tiff, 0x4949)
  view.setUint16(tiff + 2, 42, true)
  view.setUint32(tiff + 4, 8, true)
  const ifd = tiff + 8
  view.setUint16(ifd, 3, true)
  const xEntry = ifd + 2
  view.setUint16(xEntry, 0x011a, true)
  view.setUint16(xEntry + 2, 5, true)
  view.setUint32(xEntry + 4, 1, true)
  view.setUint32(xEntry + 8, 50, true)
  const yEntry = xEntry + 12
  view.setUint16(yEntry, 0x011b, true)
  view.setUint16(yEntry + 2, 5, true)
  view.setUint32(yEntry + 4, 1, true)
  view.setUint32(yEntry + 8, 58, true)
  const unitEntry = yEntry + 12
  view.setUint16(unitEntry, 0x0128, true)
  view.setUint16(unitEntry + 2, 3, true)
  view.setUint32(unitEntry + 4, 1, true)
  view.setUint16(unitEntry + 8, unit, true)
  view.setUint32(tiff + 50, densityX, true)
  view.setUint32(tiff + 54, 1, true)
  view.setUint32(tiff + 58, densityY, true)
  view.setUint32(tiff + 62, 1, true)
  return bytes.buffer
}

test('lê resolução PNG pHYs em pixels por metro', () => {
  assert.deepEqual(imageResolutionFromHeader(pngWithPhys(5906, 5906), 'image/png'), {
    resolutionDpiX: 150.01,
    resolutionDpiY: 150.01,
    resolutionSource: 'png-phys'
  })
})

test('ignora pHYs cuja unidade é desconhecida', () => {
  assert.equal(imageResolutionFromHeader(pngWithPhys(5906, 5906, 0), 'image/png'), undefined)
})

test('lê densidade JFIF em DPI e pontos por centímetro', () => {
  assert.deepEqual(imageResolutionFromHeader(jpegWithJfif(1, 300, 150), 'image/jpeg'), {
    resolutionDpiX: 300,
    resolutionDpiY: 150,
    resolutionSource: 'jpeg-jfif'
  })
  assert.deepEqual(imageResolutionFromHeader(jpegWithJfif(2, 118, 59), 'image/jpeg'), {
    resolutionDpiX: 299.72,
    resolutionDpiY: 149.86,
    resolutionSource: 'jpeg-jfif'
  })
})

test('lê resolução EXIF e prefere EXIF válido como fonte física', () => {
  assert.deepEqual(imageResolutionFromHeader(jpegWithExifResolution(300, 150), 'image/jpeg'), {
    resolutionDpiX: 300,
    resolutionDpiY: 150,
    resolutionSource: 'jpeg-exif'
  })
  assert.deepEqual(imageResolutionFromHeader(jpegWithExifResolution(118, 59, 3), 'image/jpeg'), {
    resolutionDpiX: 299.72,
    resolutionDpiY: 149.86,
    resolutionSource: 'jpeg-exif'
  })
})

test('não inventa DPI quando o formato ou unidade não informa densidade física', () => {
  assert.equal(imageResolutionFromHeader(jpegWithJfif(0, 1, 1), 'image/jpeg'), undefined)
  assert.equal(imageResolutionFromHeader(new ArrayBuffer(32), 'image/png'), undefined)
  assert.equal(imageResolutionFromHeader(new ArrayBuffer(32), 'image/gif'), undefined)
})
