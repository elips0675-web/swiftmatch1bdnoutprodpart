import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import sharp from 'sharp'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('../logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
  createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() }),
  rootLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}))

import { processImage, getImageUrls } from '../image-pipeline.js'
import processImageJob from '../jobs/image.job.js'

const SIZES = [
  { suffix: '800x800', width: 800, height: 800 },
  { suffix: '400x400', width: 400, height: 400 },
  { suffix: '200x200', width: 200, height: 200 },
]

let dir
let seq = 0

async function makeSource() {
  seq += 1
  const filePath = path.join(dir, `photo_${seq}.jpg`)
  await sharp({
    create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 120, b: 80 } },
  })
    .jpeg()
    .toFile(filePath)
  return filePath
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'image-pipeline-test-'))
})

afterAll(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 })
  } catch {
    /* libvips держит хендл на Windows — остаток в %TEMP% не мешает */
  }
})

describe('image-pipeline: processImage', () => {
  it('создаёт webp 800/400/200 и avif 800x800', async () => {
    const results = await processImage(await makeSource())
    expect(results).toHaveLength(4)
    expect(results.map((r) => r.format).sort()).toEqual(['avif', 'webp', 'webp', 'webp'])
    for (const r of results) {
      expect(fs.existsSync(r.path)).toBe(true)
    }
  })

  it('размеры ровно по SIZES, aspect 1:1 (fit cover)', async () => {
    const results = await processImage(await makeSource())
    for (const size of SIZES) {
      const found = results.find((r) => r.size === size.suffix && r.format === 'webp')
      expect(found, `нет варианта ${size.suffix}`).toBeTruthy()
      const meta = await sharp(found.path).metadata()
      expect(meta.width).toBe(size.width)
      expect(meta.height).toBe(size.height)
    }
  })

  it('avif валидный файл с корректными метаданными', async () => {
    const results = await processImage(await makeSource())
    const avif = results.find((r) => r.format === 'avif')
    expect(avif).toBeTruthy()
    const meta = await sharp(avif.path).metadata()
    expect(meta.width).toBe(800)
    expect(meta.height).toBe(800)
    expect(meta.format).toBe('heif')
  })

  it('не падает на битом файле, а возвращает пустой результат', async () => {
    seq += 1
    const broken = path.join(dir, `broken_${seq}.jpg`)
    fs.writeFileSync(broken, 'not an image at all')
    const results = await processImage(broken)
    expect(results).toHaveLength(0)
  })
})

describe('image-pipeline: getImageUrls', () => {
  it('собирает 4 URL-варианта от имени файла', () => {
    const urls = getImageUrls('/uploads/abc/photo.jpg')
    expect(urls.original).toBe('/uploads/abc/photo.jpg')
    expect(urls.large).toBe('/uploads/abc/photo_800x800.webp')
    expect(urls.medium).toBe('/uploads/abc/photo_400x400.webp')
    expect(urls.small).toBe('/uploads/abc/photo_200x200.webp')
    expect(urls.avif).toBe('/uploads/abc/photo_800x800.avif')
  })
})

describe('image.job: processImageJob', () => {
  it('обрабатывает очередь и отдаёт 4 варианта', async () => {
    const result = await processImageJob({ data: { filePath: await makeSource() } })
    expect(result.processed).toBe(4)
    for (const item of result.results) {
      expect(fs.existsSync(item.path)).toBe(true)
    }
  })

  it('повторный прогон на тот же файл (ретрай Bull) перезаписывает все 4 варианта', async () => {
    const filePath = await makeSource()
    const first = await processImageJob({ data: { filePath } })
    expect(first.processed).toBe(4)
    const second = await processImageJob({ data: { filePath } })
    expect(second.processed).toBe(4)
  })

  it('без filePath не падает, а помечает job пропущенной', async () => {
    const result = await processImageJob({ data: {} })
    expect(result.skipped).toBe(true)
  })
})
