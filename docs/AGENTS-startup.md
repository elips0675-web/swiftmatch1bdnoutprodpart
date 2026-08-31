# Startup & локальная разработка

## Startup

Run `запуск-всего.bat` to start everything:
1. MySQL via Laragon `mysqld.exe` (always check `mysql_upgrade` warnings before assuming it's broken)
2. API: `node server/src/index.js` (port 3002 — NOT 3001)
3. Frontend: `npx vite --port 8081 --host` (port 8081)

**Server .env** is in `server/.env`: `PORT=3002`, `DB_HOST=localhost`, `DB_USER=root`, `DB_PASSWORD=`, `DB_NAME=swiftmatch`, `DB_SOCKET=/tmp/mysql.sock`, `JWT_SECRET=dev-secret-key`, `JWT_EXPIRES_IN=7d`, `ADMIN_EMAIL=admin@swiftmatch.app`
**Vite proxy** targets `http://localhost:3002` in `vite.config.ts` — must match server port.

## Startup reminder

- After `git pull noutadm main` in `C:\swiftmatch1bd` (the run directory), also run `cd server && npm install` if new packages were added.
- Kill old node processes: `Get-Process -Name "node" | Stop-Process -Force`
- Start server: `cd C:\swiftmatch1bd\server && node src/index.js` — **обязательно из `server/`**: `import 'dotenv/config'` грузит `.env` относительно CWD; при запуске из корня `JWT_SECRET()` вернёт случайный секрет, все токены «сгорят» → 401 на всех эндпоинтах (проверка: `npm run check:ports` фейлит без JWT_SECRET в server/.env)
- Start frontend: `cd C:\swiftmatch1bd && npx vite --port 8081 --host`
- **Инфра может умереть сама:** mysqld падал с `RADAR_PRE_LEAK_64` (нехватка памяти под нагрузкой E2E: 3 chromium + node + vite + mysql), vite может завершиться при закрытии Laragon/перезагрузке. Признак: `ERR_CONNECTION_REFUSED` на 8081/3002, глобальный health фейлит в global-setup. Подъём: `Start-Process C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysqld.exe --defaults-file=...\my.ini` (или Laragon), сервер/фронт — командами выше. Первый E2E-прогон после холодного старта может дать флаки (vite компилирует модули) — retries: 1 локально, 2 в CI уже настроены.
