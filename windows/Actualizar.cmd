@echo off
setlocal
rem Plataforma FTTH - actualizacion (respalda antes)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ftth.ps1" actualizar
echo.
pause
