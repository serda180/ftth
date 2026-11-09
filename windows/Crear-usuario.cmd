@echo off
setlocal
rem Plataforma FTTH - crear un usuario con contrasena y rol
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0ftth.ps1" crear-usuario
echo.
pause
