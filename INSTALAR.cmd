@echo off
setlocal
rem Plataforma FTTH - instalador para Windows 10/11 Pro (pide permisos de administrador)
net session >nul 2>&1
if %errorlevel% neq 0 (
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0windows\ftth.ps1" instalar
echo.
pause
