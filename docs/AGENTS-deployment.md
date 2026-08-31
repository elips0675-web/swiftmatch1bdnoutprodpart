# 🚀 Production Deployment

## Подготовка
1. Вписать 7 ключей в `server/.env` (Stripe, SMTP, Sentry, S3, Redis, DB_PASSWORD, CORS_ORIGIN)
2. `npx vite build` — сборка фронта в `dist/`
3. `cd server && npm ci --production` — зависимости бэка

## Варианты хостинга
| Вариант | Плюсы | Минусы |
|---------|-------|--------|
| VPS (nginx + PM2) | Полный контроль | Ручное администрирование |
| Docker + VPS | Изолированно, healthcheck | Сложнее отладка |
| Railway / Fly.io | Простота, SSL | Меньше контроля |

## Nginx essentials
```nginx
location /api {
    proxy_pass http://localhost:3002;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 86400s;    # для WebSocket
    client_max_body_size 10M;     # для фото
}

location / {
    root /app/dist;
    try_files $uri $uri/ /index.html;  # SPA fallback
}
```
