@echo off
setlocal enabledelayedexpansion
title Imgpress Hub
cd /d "%~dp0"

REM ---------------------------------------------------------------------------
REM  Start Hub (Windows) - serves this folder over HTTP and opens it in Edge.
REM
REM  Chrome and Edge both block Web Workers and cross-origin module loading on
REM  file:// URLs, so opening the .html directly leaves Image Compressor with no
REM  codecs. This wrapper gives the folder a real HTTP origin first.
REM
REM  Bound to 127.0.0.1 deliberately: this exposes the whole Hub folder and
REM  should not be reachable from the office network.
REM ---------------------------------------------------------------------------

set "LANDING=index.html"
set "HOST=127.0.0.1"
set "PORT="

echo.
echo   IMGPRESS . HUB
echo   %CD%
echo.

if not exist "%LANDING%" (
  echo   [x] %LANDING% not found in this folder.
  echo       Keep this launcher next to the Hub html files.
  echo.
  pause
  exit /b 1
)

REM -- find a free port between 8080 and 8120 --------------------------------
for /l %%p in (8080,1,8120) do (
  if not defined PORT (
    netstat -ano ^| findstr /r /c:":%%p .*LISTENING" >nul 2>&1
    if errorlevel 1 set "PORT=%%p"
  )
)
if not defined PORT (
  echo   [x] No free port between 8080 and 8120.
  echo.
  pause
  exit /b 1
)

set "URL=http://%HOST%:%PORT%/%LANDING%"

REM -- pick whichever static server exists -----------------------------------
set "SERVER="
where python >nul 2>&1 && set "SERVER=python"
if not defined SERVER ( where py >nul 2>&1 && set "SERVER=py" )
if not defined SERVER ( where npx >nul 2>&1 && set "SERVER=npx" )

if not defined SERVER (
  echo   [x] No static web server available.
  echo.
  echo       Install either one, then run this launcher again:
  echo         winget install Python.Python.3.12
  echo         winget install OpenJS.NodeJS
  echo.
  pause
  exit /b 1
)

REM -- open the browser slightly after the server starts ---------------------
start "" /b cmd /c "timeout /t 2 /nobreak >nul & (start """" msedge ""%URL%"" 2>nul || start """" chrome ""%URL%"" 2>nul || start """" ""%URL%"")"

echo   server  %URL%  (%SERVER%)
echo.
echo   Leave this window open while you work.
echo   Press Ctrl-C, or close the window, to stop the server.
echo.

if "%SERVER%"=="python" python -m http.server %PORT% --bind %HOST%
if "%SERVER%"=="py"     py -m http.server %PORT% --bind %HOST%
if "%SERVER%"=="npx"    npx --yes serve --listen tcp://%HOST%:%PORT% .

endlocal
