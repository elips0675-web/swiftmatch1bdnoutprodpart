@echo off
chcp 65001 >nul
title SwiftMatch — Запуск
cd /d "%~dp0"

echo ============================================
echo   SwiftMatch — Запуск API + Фронтенд
echo ============================================
echo.

:: 1. Проверка MySQL (порт 3306)
echo [1/3] Проверка MySQL...
netstat -an 2>nul | findstr ":3306" | findstr "LISTENING" >nul
if %ERRORLEVEL% NEQ 0 (
  echo   ! MySQL не запущен (3306). Запусти его вручную или используй запуск-всего.bat
  echo.
) else (
  echo   OK MySQL доступен (3306)
)

:: 2. Запуск API сервера (порт 3002)
echo [2/3] Запуск API сервера (порт 3002)...
start "SwiftMatch API" cmd /c "cd /d ""%~dp0server"" && node src/index.js"
echo   OK API сервер запущен

:: Ждём пока API встанет
timeout /t 3 /nobreak >nul

:: 3. Запуск фронтенда (порт 8081) — build + preview (production, без HMR)
echo [3/3] Запуск фронтенда (порт 8081)...
echo.
echo   Открой в браузере: http://localhost:8081
echo.
npx vite build && npx vite preview --port 8081 --host 127.0.0.1
pause