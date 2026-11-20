@echo off
REM Double-click to start the Site Mission Reports server on Windows.
REM Uses cmd, so the PowerShell script-execution policy does not apply.
REM Close this window (or press Ctrl+C) to stop the server.
cd /d "%~dp0"
title Site Mission Reports server

where node >nul 2>nul || (echo Node.js is not installed. Install the LTS version from https://nodejs.org & pause & exit /b 1)

if not exist node_modules (
  echo Installing dependencies, first run only...
  call npm.cmd install --omit=dev || (echo Install failed. & pause & exit /b 1)
)

if "%API_TOKEN%"=="" set /p API_TOKEN=Enter the access token for this server:
if "%API_TOKEN%"=="" (echo An access token is required. & pause & exit /b 1)

echo.
echo On this PC:  http://localhost:3000
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo On a phone:  http:/%%a:3000
echo Dashboard:   http://localhost:3000/admin.html
echo.
node server\index.js
echo.
echo Server stopped.
pause
