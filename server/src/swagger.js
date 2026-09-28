import swaggerJsdoc from 'swagger-jsdoc'
import swaggerUi from 'swagger-ui-express'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROUTES_DIR = path.resolve(HERE, 'routes').replace(/\\/g, '/')

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'SwiftMatch API',
      version: '1.0.0',
      description: 'Dating app REST API documentation',
    },
    servers: [
      { url: process.env.SWAGGER_URL || process.env.API_URL || `http://localhost:${process.env.PORT || 3002}`, description: 'API' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        User: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            email: { type: 'string' },
            role: { type: 'string', enum: ['user', 'admin'] },
          },
        },
        Profile: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            display_name: { type: 'string' },
            age: { type: 'integer' },
            bio: { type: 'string' },
            gender: { type: 'string' },
            city: { type: 'string' },
            photos: { type: 'array', items: { $ref: '#/components/schemas/Photo' } },
            interests: { type: 'array', items: { $ref: '#/components/schemas/Interest' } },
          },
        },
        Photo: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            url: { type: 'string' },
            sort_order: { type: 'integer' },
            is_avatar: { type: 'boolean' },
          },
        },
        Interest: {
          type: 'object',
          properties: {
            id: { type: 'integer' },
            name_ru: { type: 'string' },
            name_en: { type: 'string' },
          },
        },
        Subscription: {
          type: 'object',
          properties: {
            tier: { type: 'string', enum: ['plus', 'gold', 'platinum'] },
            duration_months: { type: 'integer' },
            price: { type: 'number' },
            started_at: { type: 'string', format: 'date-time' },
            expires_at: { type: 'string', format: 'date-time' },
            is_active: { type: 'integer' },
          },
        },
        Error: {
          type: 'object',
          properties: {
            message: { type: 'string' },
          },
        },
      },
    },
  },
  // Glob привязан к модулю и обязательно в POSIX-виде: swagger-jsdoc резолвит
  // паттерн относительно process.cwd() и на Windows не понимает обратные слэши
  // (проверено: абсолютный путь с '\' даёт 0 путей, с '/' — все). Прежний
  // './server/src/routes/*.js' совпадал только при старте из корня репо (в Docker
  // WORKDIR=/app), а локально по запуск-всего.bat — из server/ — и тогда
  // /api-docs.json отдавал пустую документацию: 0 путей, 0 операций.
  apis: [`${ROUTES_DIR}/*.js`, `${ROUTES_DIR}/**/*.js`],
}

const swaggerSpec = swaggerJsdoc(options)

export { swaggerSpec }

export function setupSwagger(app) {
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'SwiftMatch API Docs',
  }))

  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json')
    res.json(swaggerSpec)
  })
}
