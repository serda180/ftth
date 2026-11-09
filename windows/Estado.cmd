@echo off
setlocal
rem Plataforma FTTH - estado de los servicios
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ftth.ps1" estado
echo.
pause
