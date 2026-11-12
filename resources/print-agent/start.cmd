@echo off
rem Starts the Al-Esnad print agent in the background, with no window.
rem It lets the repair desk print to this PC's printers without a dialog.
rem Starting it twice does nothing: the second copy finds the port taken and exits.
start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0print-agent.ps1"
