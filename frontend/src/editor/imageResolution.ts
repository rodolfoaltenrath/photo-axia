export interface ImageResolutionMetadata {
  resolutionDpiX: number
  resolutionDpiY: number
  resolutionSource: 'png-phys' | 'jpeg-jfif' | 'jpeg-exif'
}

interface ExifResolution {
  x: number
  y: number
}

const PNG_SIGNATURE_HIGH = 0x89504e47
const PNG_SIGNATURE_LOW = 0x0d0a1a0a
const METERS_PER_INCH = 0.0254

function normalizedDpi(value: number) {
  if (!Number.isFinite(value) || value < 1 || value > 100_000) return undefined
  return Math.round(value * 100) / 100
}

function pngResolution(view: DataView): ImageResolutionMetadata | undefined {
  if (
    view.byteLength < 8 || view.getUint32(0) !== PNG_SIGNATURE_HIGH ||
    view.getUint32(4) !== PNG_SIGNATURE_LOW
  ) return undefined

  let offset = 8
  while (offset + 12 <= view.byteLength) {
    const length = view.getUint32(offset)
    const dataStart = offset + 8
    const chunkEnd = dataStart + length + 4
    if (chunkEnd > view.byteLength) return undefined
    const type = view.getUint32(offset + 4)
    if (type === 0x70485973 && length === 9) {
      if (view.getUint8(dataStart + 8) !== 1) return undefined
      const resolutionDpiX = normalizedDpi(view.getUint32(dataStart) * METERS_PER_INCH)
      const resolutionDpiY = normalizedDpi(view.getUint32(dataStart + 4) * METERS_PER_INCH)
      return resolutionDpiX && resolutionDpiY
        ? { resolutionDpiX, resolutionDpiY, resolutionSource: 'png-phys' }
        : undefined
    }
    if (type === 0x49454e44) break
    offset = chunkEnd
  }
  return undefined
}

function exifResolution(view: DataView, dataStart: number, dataLength: number): ExifResolution | undefined {
  if (
    dataLength < 14 || dataStart + dataLength > view.byteLength ||
    view.getUint32(dataStart) !== 0x45786966 || view.getUint16(dataStart + 4) !== 0
  ) return undefined
  const tiffStart = dataStart + 6
  const byteOrder = view.getUint16(tiffStart)
  if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return undefined
  const littleEndian = byteOrder === 0x4949
  if (view.getUint16(tiffStart + 2, littleEndian) !== 42) return undefined
  const ifdOffset = view.getUint32(tiffStart + 4, littleEndian)
  const ifdStart = tiffStart + ifdOffset
  if (ifdStart + 2 > dataStart + dataLength) return undefined
  const entries = view.getUint16(ifdStart, littleEndian)
  let x: number | undefined
  let y: number | undefined
  let unit = 2
  for (let index = 0; index < entries; index++) {
    const entry = ifdStart + 2 + index * 12
    if (entry + 12 > dataStart + dataLength) return undefined
    const tag = view.getUint16(entry, littleEndian)
    const type = view.getUint16(entry + 2, littleEndian)
    const count = view.getUint32(entry + 4, littleEndian)
    if (tag === 0x0128 && type === 3 && count === 1) {
      unit = view.getUint16(entry + 8, littleEndian)
      continue
    }
    if ((tag !== 0x011a && tag !== 0x011b) || type !== 5 || count !== 1) continue
    const rationalStart = tiffStart + view.getUint32(entry + 8, littleEndian)
    if (rationalStart + 8 > dataStart + dataLength) return undefined
    const numerator = view.getUint32(rationalStart, littleEndian)
    const denominator = view.getUint32(rationalStart + 4, littleEndian)
    if (!denominator) continue
    if (tag === 0x011a) x = numerator / denominator
    else y = numerator / denominator
  }
  const factor = unit === 2 ? 1 : unit === 3 ? 2.54 : 0
  return x && y && factor ? { x: x * factor, y: y * factor } : undefined
}

function jpegResolution(view: DataView): ImageResolutionMetadata | undefined {
  if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return undefined
  let jfif: ImageResolutionMetadata | undefined
  let exif: ImageResolutionMetadata | undefined
  let offset = 2
  while (offset + 4 <= view.byteLength) {
    while (offset < view.byteLength && view.getUint8(offset) === 0xff) offset++
    if (offset >= view.byteLength) break
    const marker = view.getUint8(offset++)
    if (marker === 0xd9 || marker === 0xda) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > view.byteLength) break
    const length = view.getUint16(offset)
    if (length < 2 || offset + length > view.byteLength) break
    const dataStart = offset + 2
    if (
      marker === 0xe0 && length >= 16 &&
      view.getUint32(dataStart) === 0x4a464946 && view.getUint8(dataStart + 4) === 0
    ) {
      const unit = view.getUint8(dataStart + 7)
      const factor = unit === 1 ? 1 : unit === 2 ? 2.54 : 0
      const resolutionDpiX = normalizedDpi(view.getUint16(dataStart + 8) * factor)
      const resolutionDpiY = normalizedDpi(view.getUint16(dataStart + 10) * factor)
      if (resolutionDpiX && resolutionDpiY) {
        jfif = { resolutionDpiX, resolutionDpiY, resolutionSource: 'jpeg-jfif' }
      }
    } else if (marker === 0xe1) {
      const resolution = exifResolution(view, dataStart, length - 2)
      const resolutionDpiX = normalizedDpi(resolution?.x ?? 0)
      const resolutionDpiY = normalizedDpi(resolution?.y ?? 0)
      if (resolutionDpiX && resolutionDpiY) {
        exif = { resolutionDpiX, resolutionDpiY, resolutionSource: 'jpeg-exif' }
      }
    }
    offset += length
  }
  return exif ?? jfif
}

export function imageResolutionFromHeader(buffer: ArrayBuffer, mimeType: string) {
  const view = new DataView(buffer)
  if (mimeType === 'image/png') return pngResolution(view)
  if (mimeType === 'image/jpeg') return jpegResolution(view)
  return undefined
}
