@echo off
rem =====================================================================
rem  SSRF lab - start all four local services (each in its own window)
rem  ASCII only: cmd.exe parses .bat in the OEM codepage.
rem  Close the four black windows to stop everything.
rem =====================================================================
title SSRF lab - start all
cd /d "%~dp0"

set "NODE_EXE=D:\nodejs\node.exe"
if not exist "%NODE_EXE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo   [ERROR] node.exe not found. Install Node 18+ or edit NODE_EXE in this file.
    pause & exit /b 1
  )
  set "NODE_EXE=node"
)

echo.
echo   starting 4 services...
echo    7401  victim        simulated internal service, NO auth
echo    7400  proxy-bad     the vulnerable proxy  (intentionally insecure)
echo    7410  proxy-fixed   the hardened proxy
echo    7402  evil page     http://127.0.0.1:7402/   <-- open this in your browser
echo.

start "SSRF lab - victim (7401)"       "%NODE_EXE%" victim.mjs
start "SSRF lab - proxy-bad (7400)"    "%NODE_EXE%" proxy-bad.mjs
start "SSRF lab - proxy-fixed (7410)"  "%NODE_EXE%" proxy-fixed.mjs
start "SSRF lab - evil page (7402)"    "%NODE_EXE%" evil-server.mjs

ping -n 3 127.0.0.1 >nul 2>nul
start "" "http://127.0.0.1:7402/"

echo   done. open: http://127.0.0.1:7402/
echo   to stop: close the 4 windows, or run stop-all.bat
echo.
pause
