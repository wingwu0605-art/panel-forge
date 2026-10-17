@echo off
rem ---------------------------------------------------------------
rem  PanelForge  -  stop script (kills whatever listens on port 7311)
rem  ASCII only: cmd.exe parses .bat in the OEM codepage.
rem ---------------------------------------------------------------
title PanelForge  stop
setlocal
set "PORT=7311"

powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force; Write-Host ('  stopped PID ' + $_.OwningProcess) } catch { Write-Host '  failed: ' $_.Exception.Message } } } else { Write-Host '  nothing listening on port %PORT%' }"

echo.
ping -n 3 127.0.0.1 >nul 2>nul
exit /b 0
