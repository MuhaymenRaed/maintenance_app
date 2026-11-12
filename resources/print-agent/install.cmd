@echo off
rem Makes the Al-Esnad print agent start with Windows for this user, then starts it.
rem Needs no administrator rights: it is a shortcut in this user's Startup folder.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'Al-Esnad print agent.lnk'; $shell = New-Object -ComObject WScript.Shell; $shortcut = $shell.CreateShortcut($link); $shortcut.TargetPath = '%~dp0start.cmd'; $shortcut.WorkingDirectory = '%~dp0'; $shortcut.WindowStyle = 7; $shortcut.Save(); Write-Host ('Will start with Windows: ' + $link)"
call "%~dp0start.cmd"
echo The print agent is running. You can close this window.
pause
