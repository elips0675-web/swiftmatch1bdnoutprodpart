FROM node:22-alpine AS frontend
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS server
RUN apk add --no-cache curl
WORKDIR /app
COPY server/package*.json ./server/
RUN cd server && npm ci --omit=dev
COPY server/ ./server/
COPY --from=frontend /app/dist ./dist
COPY database/ ./database/
COPY scripts/ ./scripts/
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3002/health || exit 1
USER node
# Миграции идемпотентны (_migrations) и обязательны для производственной БД.
CMD ["sh", "-c", "node database/migrations/migrate.js && node server/src/index.js"]

FROM nginx:1.27-alpine AS web
# Статика из frontend-этапа + конфиг nginx. Образ самодостаточен (не зависит от хост-папки ./dist).
COPY --from=frontend /app/dist /usr/share/nginx/html
COPY nginx/swiftmatch.http.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://localhost/ || exit 1