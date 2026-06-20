@echo off
cd /d "%~dp0"
echo ============================================
echo   Edward ^& Christie - Service Record System - Startup
echo ============================================
echo.

REM Stop any existing server on port 2300 to prevent port conflicts
FOR /F "tokens=5" %%T IN ('netstat -ano ^| find "LISTENING" ^| findstr ":2300 "') DO (
    taskkill /F /PID %%T >nul 2>&1
)

REM Install dependencies on first run
if not exist "node_modules" (
    echo Installing dependencies - first run only...
    call npm install
    echo.
)

REM Seed database if it does not exist yet.
if not exist "data\service.db" (
    echo Building database from your data - first run only...
    call npm run seed
    echo.
)

echo Starting server...
start "Service Record System Backend" cmd /k "node server.js"
echo.
echo Server started. Keep the new window open while using the app.
ping 127.0.0.1 -n 3 >nul
start http://localhost:2300
echo.
echo App opened at: http://localhost:2300
pause
