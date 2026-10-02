import sharp from 'sharp'
import path from 'path'
import { rootLogger } from './logger.js'

const SIZES = [
  { suffix: '800x800', width: 800, height: 800 },
  { suffix: '400x400', width: 400, height: 400 },
  { suffix: '200x200', width: 200, height: 200 },
]

export async function processImage(filePath) {
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath)
  const baseName = path.basename(filePath, ext)

  const results = []

  for (const size of SIZES) {
    const webpPath = path.join(dir, `${baseName}_${size.suffix}.webp`)
    try {
      await sharp(filePath)
        .resize(size.width, size.height, { fit: 'cover', position: 'center' })
        .webp({ quality: 80, effort: 4 })
        .toFile(webpPath)
      results.push({
        size: size.suffix,
        path: webpPath,
        format: 'webp',
      })
    } catch (err) {
      rootLogger.error(`Sharp resize ${size.suffix} failed:`, err)
    }
  }

  // Also produce one AVIF version for modern browsers
  const avifPath = path.join(dir, `${baseName}_800x800.avif`)
  try {
    await sharp(filePath)
      .resize(800, 800, { fit: 'cover', position: 'center' })
      .avif({ quality: 65, effort: 4 })
      .toFile(avifPath)
    results.push({
      size: '800x800',
      path: avifPath,
      format: 'avif',
    })
  } catch (err) {
    rootLogger.error('Sharp AVIF conversion failed:', err)
  }

  return results
}

export function getImageUrls(originalUrl) {
  const ext = path.extname(originalUrl)
  const baseName = path.basename(originalUrl, ext)
  const dir = path.dirname(originalUrl)

  return {
    original: originalUrl,
    large: `${dir}/${baseName}_800x800.webp`,
    medium: `${dir}/${baseName}_400x400.webp`,
    small: `${dir}/${baseName}_200x200.webp`,
    avif: `${dir}/${baseName}_800x800.avif`,
  }
}
