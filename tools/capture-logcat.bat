@echo off
setlocal
cd /d "%~dp0.."

set "LOGDIR=%CD%\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%i"
set "LOGFILE=%LOGDIR%\logcat-%STAMP%.txt"

echo ================================================================
echo  dinosour crash capture
echo ================================================================
echo.
echo Checking for a connected device...
adb devices
echo.

echo Clearing the old log buffer...
adb logcat -c

echo.
echo Capturing to: %LOGFILE%
echo.
echo  >> Open dinosour on the phone and reproduce the crash. <<
echo  >> Press Ctrl+C here when you have captured it.        <<
echo.
echo (The crash itself will be tagged DinosourCrash in the log,
echo  alongside the standard AndroidRuntime FATAL EXCEPTION block.)
echo.

adb logcat -v threadtime > "%LOGFILE%"

echo.
echo Saved to %LOGFILE%
pause
