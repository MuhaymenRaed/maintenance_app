@echo off
rem Sets this PC up to print from the repair desk with no dialog: a task that
rem starts the agent when you sign in, the alesnad-print: handler so the
rem dashboard can start it again on your press if it ever stops, and the agent
rem itself, started now. Needs no administrator rights. Run it ONCE per PC.
rem Nothing here runs on a timer. status.cmd says whether it worked.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
echo You can close this window.
pause
