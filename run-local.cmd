@echo off
rem Double-click to run Pedal Sim on this computer at http://localhost:8080/
rem Needs Node.js (LTS) from https://nodejs.org
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js is not installed. Install the LTS version from https://nodejs.org
  echo   then double-click run-local.cmd again.
  echo.
  pause
  exit /b 1
)
rem open the browser a moment after the server starts
start "" /min cmd /c "timeout /t 1 /nobreak >nul & start http://localhost:8080/"
node tools\serve.js 8080
pause
