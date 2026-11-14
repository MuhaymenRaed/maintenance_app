@echo off
rem Says whether this PC is set up to print from the repair desk: the protocol,
rem the sign-in task and the agent itself, each named separately. Read-only --
rem it registers nothing and starts nothing. Run install.cmd if it says MISSING.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0status.ps1"
pause
