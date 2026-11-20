@echo off
setlocal
cd /d "%~dp0.."

set "SRC=%CD%\mobile\debug.keystore"
set "DEST=%USERPROFILE%\Documents\dinosour-keystore-backup"

if not exist "%SRC%" (
  echo ERROR: %SRC% not found.
  exit /b 1
)

if not exist "%DEST%" mkdir "%DEST%"
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%i"

copy /Y "%SRC%" "%DEST%\debug.keystore-%STAMP%.bak" >nul
echo Signing keystore backed up to:
echo   %DEST%\debug.keystore-%STAMP%.bak
echo.
echo Keep this file safe. If mobile\debug.keystore is ever lost, every
echo installed copy of dinosour will refuse future updates ("package
echo conflicts") unless the SAME keystore is used again.
echo.
for /f %%h in ('powershell -NoProfile -Command "(Get-FileHash '%SRC%' -Algorithm SHA256).Hash"') do echo Source keystore SHA-256: %%h
