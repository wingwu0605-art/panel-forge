@echo off
rem ---------------------------------------------------------------
rem  PanelForge / fen jing fang  -  start script (double-click me)
rem  ASCII only on purpose: cmd.exe parses .bat in the OEM codepage,
rem  so non-ASCII text inside a batch file can break the parser.
rem ---------------------------------------------------------------
title PanelForge  server   [close this window = stop]
cd /d "%~dp0"

set "PORT=7311"
set "URL=http://127.0.0.1:7311/"

rem --- locate node. On this machine node is at D:\nodejs (not in PATH) ---
set "NODE_EXE=D:\nodejs\node.exe"
if exist "%NODE_EXE%" goto have_node
where node >nul 2>nul
if errorlevel 1 goto no_node
set "NODE_EXE=node"
goto have_node

:no_node
echo.
echo   [ERROR] node.exe not found.
echo   Edit the line  set "NODE_EXE=D:\nodejs\node.exe"
echo   and point it to your node.exe, e.g. C:\Program Files\nodejs\node.exe
echo.
pause
exit /b 1

:have_node
rem --- is the port already listening? then just open the page ---
powershell -NoProfile -Command "try { Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction Stop | Out-Null; exit 0 } catch { exit 1 }"
if errorlevel 1 goto start_it

echo.
echo   Already running: %URL%
echo   Opening the page, no second instance started.
if not "%~1"=="--check" start "" "%URL%"
if "%~1"=="--check" echo   [check] port %PORT% busy - script would only open the browser.
ping -n 3 127.0.0.1 >nul 2>nul
exit /b 0

:start_it
echo.
echo   PanelForge  -  starting...
echo   node : %NODE_EXE%
echo   url  : %URL%
echo   (close this window to stop the server)
echo.
if "%~1"=="--check" echo   [check] node found, port %PORT% free - all good. & exit /b 0

rem open the browser 2s later, silently
start "" /min powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process '%URL%'"

"%NODE_EXE%" server.mjs

echo.
echo   Server stopped.
pause
