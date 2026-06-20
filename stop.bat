@echo off
cd /d "%~dp0"
echo Stopping Service Record System Server (Port 2300)...

REM Find the process listening on port 2300 and kill it
FOR /F "tokens=5" %%T IN ('netstat -ano ^| find "LISTENING" ^| findstr ":2300 "') DO (
    echo Found running server with PID %%T
    taskkill /F /PID %%T
)

echo.
echo Server stopped successfully.
pause
