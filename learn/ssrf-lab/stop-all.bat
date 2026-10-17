@echo off
rem Stop all SSRF lab services (kills whatever listens on 7400/7401/7402/7410)
title SSRF lab - stop all
for %%P in (7400 7401 7402 7410) do (
  powershell -NoProfile -Command "$c = Get-NetTCPConnection -LocalPort %%P -State Listen -ErrorAction SilentlyContinue; if ($c) { $c | ForEach-Object { try { Stop-Process -Id $_.OwningProcess -Force; Write-Host ('  stopped port %%P (PID ' + $_.OwningProcess + ')') } catch {} } } else { Write-Host '  port %%P idle' }"
)
echo.
ping -n 3 127.0.0.1 >nul 2>nul
