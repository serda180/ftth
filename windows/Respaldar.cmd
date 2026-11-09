@echo off
setlocal
rem Plataforma FTTH - respaldo de base de datos y fotos
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ftth.ps1" respaldar
echo.
pause
