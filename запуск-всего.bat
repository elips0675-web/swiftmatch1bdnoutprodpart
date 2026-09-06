@echo off
title SwiftMatch — Запуск
chcp 65001 >nul
cd /d "%~dp0"

echo [1/3] MySQL...
start "MySQL" /min "C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysqld.exe" --defaults-file="C:\laragon\bin\mysql\mysql-8.4.3-winx64\my.ini"
timeout /t 4 /nobreak >nul

echo [2/3] API (http://localhost:3002)...
start "API" cmd /c "cd /d ""%~dp0server"" && node src/index.js"

echo [3/3] Frontend (http://localhost:8081) — build + preview (production)...
start "Frontend" cmd /c "cd /d ""%~dp0"" && npx vite build && npx vite preview --port 8081 --host"

timeout /t 6 /nobreak >nul
start http://localhost:8081

echo.
echo  MySQL  — 3306
echo  API    — http://localhost:3002
echo  Front  — http://localhost:8081
echo.
pause