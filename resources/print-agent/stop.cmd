@echo off
rem Stops the Al-Esnad print agent. To stop it starting with Windows as well,
rem delete "Al-Esnad print agent" from the Startup folder (Win+R, shell:startup).
powershell.exe -NoProfile -Command "try { Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:17777/v1/quit' -Headers @{ 'X-Al-Esnad-Print' = '1' } -Body '' | Out-Null; Write-Host 'Print agent stopped.' } catch { Write-Host 'The print agent was not running.' }"
