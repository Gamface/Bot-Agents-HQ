@echo off
REM Start Mission Control on Windows: double-click this file.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Get it from https://nodejs.org ^(version 18 or newer^), then run this again.
  pause
  exit /b 1
)
if "%PORT%"=="" set PORT=4000
start "" http://localhost:%PORT%
node server.js
pause
