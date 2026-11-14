@echo off
rem Starts the Al-Esnad print agent now, and lets it start again at sign-in.
rem Starting it twice does nothing: ensure.ps1 probes the port before it starts
rem anything, and the agent itself exits if the port is already taken.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Enable-ScheduledTask -TaskName 'Al-Esnad print agent' -ErrorAction SilentlyContinue | Out-Null"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0ensure.ps1"
if errorlevel 1 (echo The agent did not start. See %%LOCALAPPDATA%%\AlEsnadPrint\agent.log) else (echo The print agent is running.)
