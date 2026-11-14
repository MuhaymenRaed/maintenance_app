@echo off
rem Undoes install.cmd: stops the agent, removes the scheduled task that keeps
rem it running and the alesnad-print: handler. install.cmd puts them all back.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Remove
echo.
pause
