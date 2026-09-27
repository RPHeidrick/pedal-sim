@echo off
rem Drag a WAV recording onto this file to add it to the site (up to 16).
rem Needs Node.js (the same as run-local.cmd).
cd /d "%~dp0"
if "%~1"=="" (
  echo.
  echo   Drag a WAV file onto add-recording.cmd to add it to the site.
  echo   Your recordings so far:
  echo.
  node tools\add-recording.js --list
  echo.
  pause
  exit /b 0
)
echo.
echo   Adding: %~nx1
echo.
set "NAME="
set "KIND="
set "GOOD="
set "FIRST="
set /p NAME=  Name visitors will see (for example: Crunchy riff): 
set /p KIND=  Electric, acoustic or bass? (press Enter for electric): 
set /p GOOD=  What is it good for hearing? (optional, press Enter to skip): 
set /p FIRST=  Make this the first sound visitors hear? (y/N): 
set "EXTRA="
if /i "%FIRST%"=="y" set "EXTRA=--default"
if "%KIND%"=="" set "KIND=electric"
echo.
node tools\add-recording.js "%~1" --name "%NAME%" --kind "%KIND%" --good "%GOOD%" %EXTRA%
echo.
pause
