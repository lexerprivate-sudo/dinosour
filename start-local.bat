@echo off
setlocal EnableDelayedExpansion
cd /d "%~dp0"

rem Fresh origin (3222) avoids a stale service worker left on 3210 by another app.
rem Pick a free port from there so Chrome always opens the right URL.
set "PORT="
for /f %%i in ('powershell -NoProfile -Command "$p=3222; while (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue) { $p++ }; $p" 2^>nul') do set "PORT=%%i"
if not defined PORT set "PORT=3222"

echo ================================================================
echo  dinosour local server
echo ================================================================
echo.
echo  Web app: http://localhost:%PORT%
echo  Phone:   http://^<your-computer-ip^>:%PORT%
echo.
echo Starting the server, then opening Google Chrome...
echo.

set "CHROME="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "CHROME=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" set "CHROME=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"

if defined CHROME (
  start "" "%CHROME%" "http://localhost:%PORT%"
) else (
  echo Chrome was not found in the usual locations; opening the default browser.
  start "" "http://localhost:%PORT%"
)

rem Keep this window open; close it (Ctrl+C) to stop the server.
node server.js
pause
