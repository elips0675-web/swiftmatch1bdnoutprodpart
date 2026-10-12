@echo off
title SwiftMatch — Запуск
chcp 65001 >nul
cd /d "%~dp0"

echo [1/5] MySQL...
start "MySQL" /min "C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysqld.exe" --defaults-file="C:\laragon\bin\mysql\mysql-8.4.3-winx64\my.ini"
timeout /t 4 /nobreak >nul

echo [2/5] Redis (127.0.0.1:6379)...
start "Redis" /min /d "C:\laragon\bin\redis\redis-x64-5.0.14.1" "C:\laragon\bin\redis\redis-x64-5.0.14.1\redis-server.exe" "C:\laragon\bin\redis\redis-x64-5.0.14.1\redis.windows.conf"

echo [3/5] Migrations (database\migrations\migrate.js)...
node database\migrations\migrate.js

echo [4/5] API (http://localhost:3002)...
start "API" cmd /c "cd /d ""%~dp0server"" && set REDIS_URL=redis://localhost:6379 && node src/index.js"

echo [5/5] Frontend (http://localhost:8081) — build + preview (production)...
start "Frontend" cmd /k "cd /d ""%~dp0"" && npx vite build && npx vite preview --port 8081 --host"

timeout /t 6 /nobreak >nul
start http://localhost:8081

echo.
echo  MySQL  — 3306
echo  Redis  — 6379
echo  API    — http://localhost:3002
echo  Front  — http://localhost:8081
echo.
pause