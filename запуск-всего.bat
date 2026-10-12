@echo off
title SwiftMatch — Запуск
chcp 65001 >nul
cd /d "%~dp0"

echo [1/4] MySQL...
start "MySQL" /min "C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysqld.exe" --defaults-file="C:\laragon\bin\mysql\mysql-8.4.3-winx64\my.ini"
timeout /t 4 /nobreak >nul

echo [2/4] Migrations (database\migrations\migrate.js)...
node database\migrations\migrate.js

echo [3/4] API (http://localhost:3002)...
start "API" cmd /c "cd /d ""%~dp0server"" && node src/index.js"

echo [4/4] Frontend (http://localhost:8081) — build + preview (production)...
start "Frontend" cmd /k "cd /d ""%~dp0"" && npx vite build && npx vite preview --port 8081 --host"

timeout /t 6 /nobreak >nul
start http://localhost:8081

echo.
echo  MySQL  — 3306
echo  API    — http://localhost:3002
echo  Front  — http://localhost:8081
echo.
pause