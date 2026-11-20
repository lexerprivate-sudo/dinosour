@echo off
setlocal
cd /d "%~dp0"

rem Fixed port so the Chrome URL is always correct.
set "PORT=3210"

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
