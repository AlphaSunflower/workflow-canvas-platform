@echo off
setlocal
cd /d "%~dp0"
node ".\scripts\start-backend.mjs" --start
endlocal
