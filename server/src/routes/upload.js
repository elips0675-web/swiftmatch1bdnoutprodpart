import { Router } from 'express'
import multer from 'multer'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import os from 'os'
import pool from '../db.js'
import { auth, optionalAuth } from '../middleware.js'
import logger from '../logger.js'
import { processImage } from '../image-pipeline.js'
import { moderateImage } from '../ai-moderation.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const UPLOAD_DIR = path.resolve(__dirname, '../../uploads')

const USE_S3 = !!(process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID)

let storage
let s3ClientPromise = null

async function getS3Client() {
  if (!s3ClientPromise) {
    s3ClientPromise = import('@aws-sdk/client-s3').then(({ S3Client }) =>
      new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
        ...(process.env.S3_ENDPOINT ? { endpoint: process.env.S3_ENDPOINT } : {}),
      }),
    )
  }
  return s3ClientPromise
}

async function initStorage() {
  if (storage) return storage

  if (USE_S3) {
    const multerS3 = (await import('multer-s3')).default
    const s3 = await getS3Client()
    storage = multerS3({
      s3,
      bucket: process.env.S3_BUCKET,
      contentType: multerS3.AUTO_CONTENT_TYPE,
      key: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, 'uploads/' + unique + path.extname(file.originalname))
      },
    })
  } else {
    storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, UPLOAD_DIR),
      filename: (req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1E9)
        cb(null, unique + path.extname(file.originalname))
      },
    })
  }
  return storage
}

const router = Router()

let uploadMiddleware

async function getUpload() {
  if (!uploadMiddleware) {
    const s = await initStorage()
    uploadMiddleware = multer({
      storage: s,
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith('image/')) {
          return cb(new Error('Only image files (jpg, jpeg, png, gif, webp) are allowed'))
        }
        const allowed = /\.(jpg|jpeg|png|gif|webp)$/i
        if (allowed.test(path.extname(file.originalname))) return cb(null, true)
        cb(new Error('Only image files (jpg, jpeg, png, gif, webp) are allowed'))
      },
    })
  }
  return uploadMiddleware.single('photo')
}

// Обновление статуса модерации после INSERT (photoId известен только после вставки)
async function updateModeration(photoId, modResult) {
  if (!photoId) return
  if (!modResult.safe) {
    await pool.query(
      "UPDATE user_photos SET moderation_status = 'flagged', moderation_reason = ? WHERE id = ?",
      [modResult.reasons.join(', '), photoId],
    )
    logger.warn(`Photo ${photoId} flagged by AI: ${modResult.reasons.join(', ')}`)
  } else {
    await pool.query(
      "UPDATE user_photos SET moderation_status = 'approved' WHERE id = ?",
      [photoId],
    )
  }
}

router.post('/api/upload', optionalAuth, async (req, res) => {
  try {
    const single = await getUpload()
    await new Promise((resolve, reject) => {
      single(req, res, (err) => {
        if (err) reject(err)
        else resolve()
      })
    })

    if (!req.file) return res.status(400).json({ message: 'No file uploaded' })

    if (!req.userId && !req.body.user_id) {
      return res.status(401).json({ message: 'Authentication required' })
    }
    const userId = req.userId || req.body.user_id
    const sortOrder = req.body.sort_order || 0
    // S3: multer-s3 кладёт location/key (не filename), локально — filename
    const url = USE_S3 ? req.file.location : `/uploads/${req.file.filename}`

    const [result] = await pool.query(
      'INSERT INTO user_photos (user_id, url, sort_order) VALUES (?, ?, ?)',
      [userId, url, parseInt(sortOrder)],
    )
    const photoId = result.insertId

    if (USE_S3) {
      // S3: скачиваем оригинал во временный файл, режем варианты и запускаем модерацию
      const { GetObjectCommand, PutObjectCommand } = await import('@aws-sdk/client-s3')
      const s3 = await getS3Client()
      const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sm-img-'))
      const tmpOriginal = path.join(tmpDir, path.basename(req.file.key))
      try {
        const obj = await s3.send(new GetObjectCommand({ Bucket: process.env.S3_BUCKET, Key: req.file.key }))
        await fs.promises.writeFile(tmpOriginal, Buffer.from(await obj.Body.transformToByteArray()))

        const dir = path.dirname(req.file.key)
        const tasks = [
          processImage(tmpOriginal).then(async (results) => {
            for (const r of results) {
              const key = `${dir}/${path.basename(r.path)}`
              await s3.send(new PutObjectCommand({
                Bucket: process.env.S3_BUCKET,
                Key: key,
                Body: await fs.promises.readFile(r.path),
                ContentType: r.format === 'avif' ? 'image/avif' : 'image/webp',
              }))
            }
          }),
          moderateImage(tmpOriginal).then((modResult) => updateModeration(photoId, modResult)),
        ]
        // Ждём, чтобы не удалить tmpDir под sharp'ом; ошибки не роняют ответ
        const settled = await Promise.allSettled(tasks)
        settled.forEach((r, i) => {
          if (r.status === 'rejected') {
            logger.error(i === 0 ? 'Image pipeline error:' : 'AI moderation error:', r.reason)
          }
        })
      } catch (err) {
        logger.error('S3 file process error:', err)
      } finally {
        fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
      }
    } else if (req.file.path) {
      const tasks = [
        processImage(req.file.path),
        moderateImage(req.file.path).then((modResult) => updateModeration(photoId, modResult)),
      ]
      const settled = await Promise.allSettled(tasks)
      settled.forEach((r, i) => {
        if (r.status === 'rejected') {
          logger.error(i === 0 ? 'Image pipeline error:' : 'AI moderation error:', r.reason)
        }
      })
    }

    res.json({
      id: photoId,
      url,
      sort_order: parseInt(sortOrder),
      is_avatar: false,
    })
  } catch (err) {
    logger.error('Upload error:', err)
    res.status(500).json({ message: 'Upload failed' })
  }
})

// Удаление фото из S3/диска по фактическому ключу (url может быть абсолютным S3-URL)
async function s3KeyFromUrl(url) {
  if (/^https?:\/\//.test(url)) {
    return new URL(url).pathname.replace(/^\//, '')
  }
  return url.replace(/^\/uploads\//, 'uploads/')
}

router.delete('/api/photos/:id', auth, async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT url FROM user_photos WHERE id = ?', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ message: 'Photo not found' })

    if (USE_S3) {
      const { DeleteObjectCommand } = await import('@aws-sdk/client-s3')
      const s3 = await getS3Client()
      const key = await s3KeyFromUrl(rows[0].url)
      await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: key }))
    } else {
      const filePath = path.join(UPLOAD_DIR, path.basename(rows[0].url))
      try { fs.unlinkSync(filePath) } catch {}
    }

    await pool.query('DELETE FROM user_photos WHERE id = ?', [req.params.id])
    res.json({ success: true })
  } catch (err) {
    logger.error('Delete photo error:', err)
    res.status(500).json({ message: 'Delete failed' })
  }
})

router.get('/api/photos/:userId', auth, async (req, res) => {
  try {
    const [rows] = await pool.query(
      'SELECT id, url, sort_order, is_avatar FROM user_photos WHERE user_id = ? ORDER BY sort_order',
      [req.params.userId],
    )
    res.json(rows)
  } catch (err) {
    logger.error('Photos GET error:', err)
    res.status(500).json({ message: 'Failed to fetch photos' })
  }
})

export default router