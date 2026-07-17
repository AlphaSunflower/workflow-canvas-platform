@echo off
setlocal

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0verify-quality.ps1"
exit /b %errorlevel%
