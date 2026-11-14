@echo off
rem Stops the Al-Esnad print agent, and stops it starting again at sign-in.
rem Without that second half it would be back at the next logon. The DASHBOARD
rem will still start it when somebody opens a repair desk and presses print --
rem that is by design, and uninstall.cmd (or saying no to the browser's
rem question) is what stops that too. start.cmd brings both back.
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Disable-ScheduledTask -TaskName 'Al-Esnad print agent' -ErrorAction SilentlyContinue | Out-Null; try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:17777/v1/quit' -Headers @{ 'X-Al-Esnad-Print' = '1' } -Body '' | Out-Null; Write-Host 'Print agent stopped. start.cmd brings it back.' } catch { Write-Host 'The print agent was not running.' }"
