# Startup & локальная разработка

## Startup

Run `запуск-всего.bat` to start everything:
1. MySQL via Laragon `mysqld.exe` (always check `mysql_upgrade` warnings before assuming it's broken)
2. Redis via Laragon `redis-server.exe` (127.0.0.1:6379; без него очереди email/push/image отключаются и уходят в прямой fallback — локальная среда должна повторять прод, где Redis есть в `docker-compose`)
3. Migrations: `node database/migrations/migrate.js` — иначе созданная раньше БД молча отстаёт от кода, и живые роуты дают 500 на новых колонках (грабля №99)
4. API: `REDIS_URL=redis://localhost:6379 node server/src/index.js` (port 3002 — NOT 3001)
5. Frontend: `npx vite build && npx vite preview --port 8081 --host` (production preview, port 8081)

**Production-режим фронта (требование пользователя, сент 2026):** dev-server с HMR убран из запуска — холодная компиляция модулей делала первый заход в админку ~2.6 с («тупит приложение»). `запуск-всего.bat`/`запуск.bat` собирают `build` и поднимают `vite preview`. `vite.config.ts` содержит `preview.proxy` для `/api` и `/socket.io` (иначе preview отдаёт 404 на API). Для HMR-разработки фронт запускать вручную: `npx vite --port 8081 --host`. После любой правки `src/` нужен перезапуск `npx vite build` + рестарт preview (dist-папка кэшируется процессами).

**Server .env** is in `server/.env`: `PORT=3002`, `DB_HOST=localhost`, `DB_USER=root`, `DB_PASSWORD=`, `DB_NAME=swiftmatch`, `DB_SOCKET=/tmp/mysql.sock`, `JWT_SECRET=dev-secret-key`, `JWT_EXPIRES_IN=7d`, `ADMIN_EMAIL=admin@swiftmatch.app`
**Vite proxy** targets `http://localhost:3002` in `vite.config.ts` — must match server port.

## Startup reminder

- After `git pull noutadm main` in `C:\swiftmatch1bd` (the run directory), also run `cd server && npm install` if new packages were added.
- Kill old node processes: `Get-Process -Name "node" | Stop-Process -Force`
- Start server: `cd C:\swiftmatch1bd\server && node src/index.js` — **обязательно из `server/`**: `import 'dotenv/config'` грузит `.env` относительно CWD; при запуске из корня `JWT_SECRET()` вернёт случайный секрет, все токены «сгорят» → 401 на всех эндпоинтах (проверка: `npm run check:ports` фейлит без JWT_SECRET в server/.env)
- Start frontend: `cd E:\Eswiftmatch1bdnoutprodpart1 && npx vite build && npx vite preview --port 8081 --host` (или `npx vite --port 8081 --host` для HMR)
- **Инфра может умереть сама:** mysqld падал с `RADAR_PRE_LEAK_64` (нехватка памяти под нагрузкой E2E: 3 chromium + node + vite + mysql), vite может завершиться при закрытии Laragon/перезагрузке. Признак: `ERR_CONNECTION_REFUSED` на 8081/3002, глобальный health фейлит в global-setup. Подъём: `Start-Process C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysqld.exe --defaults-file=...\my.ini` (или Laragon), сервер/фронт — командами выше. Первый E2E-прогон после холодного старта может дать флаки (vite компилирует модули) — retries: 1 локально, 2 в CI уже настроены.

## Docker и порты (локально)

- **Docker и Laragon локально одновременно не поднимать.** `docker-compose.yml` — для VPS/staging, не для этой машины: контейнер `redis` публикует `6379:6379` (конфликт с Laragon Redis, `запуск-всего.bat:11`), контейнер `app` — `3002:3002` (конфликт с локальным API, `запуск-всего.bat:17`). Локальная инфра — только Laragon (`mysqld.exe` 3306, `redis-server.exe` 6379). **Исключение — интеграционный прогон TEST-03** (Docker Desktop 4.95.0 установлен 18.10.2026 после WSL 3.0.3.0): контур `docker-compose.integration.yml` (override поверх `docker-compose.yml`) публикует порты `!override` мимо занятых (db 3308, redis 6380, maildev 1125/1180, API-смоук 3102) и запускается только через `npm run test:integration` (сам поднимает и сносит контейнеры через `down -v`); вручную `docker compose up` основного файла на этой машине не запускать.
- **Порт OpenCode (агента) — случайный.** Слушает `127.0.0.1:49xxx` из динамического диапазона Windows (12.10.2026 в логах были `49374` и `49762`); фиксированные порты проекта (3306/6379/3002/8081) его не занимают. В скриптах проекта (`запуск-всего.bat`, `запуск.bat`, `scripts\*.ps1`) нет `taskkill`/`Stop-Process` по порту — они агента не задевают.
- **Самоперезапуск OpenCode = авто-обновление, а не порт.** 12.10.2026: v1.16.0 → v2.0.11 (`sidecar exited { code: 0 }` в `%APPDATA%\ai.opencode.desktop\logs\<ts>\main.log`), следом качалось 2.0.27. В логах нет `EADDRINUSE` и нет дампов в `%APPDATA%\ai.opencode.desktop\Crashpad`. Не «лечить» это убийством процессов по порту — так гасится сам агент.
