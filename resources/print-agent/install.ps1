<#
  Sets this PC up to print from the repair desk with no dialog, and keeps it
  that way.

      powershell -ExecutionPolicy Bypass -File tools\print-agent\install.ps1
      powershell -ExecutionPolicy Bypass -File tools\print-agent\install.ps1 -Remove

  install.cmd and uninstall.cmd are the double-click versions. Neither needs
  administrator rights: a scheduled task and a protocol entry, both this
  user's own.

  Three things, and none of them runs on a timer.

  1. A scheduled task, "Al-Esnad print agent", running ensure.ps1 **at logon
     and at no other time**. One start, when somebody signs in, so the agent
     is usually listening before anybody asks it for anything.

     ** The three-minute repeat is GONE, and must not come back.** It was
     added on 2026-11-12 and the shop reported it the same week: "the current
     cmd orders that could effect the performance of the laptop or pc". They
     were right. ensure.ps1 is cheap once it is running -- a probe at a port
     -- but *getting there* is a whole PowerShell start, so twenty times an
     hour, for ever, on a PC that is also running the till, nearly all of the
     work was the cost of asking rather than the cost of the answer.

     What replaced it is the dashboard asking for itself:
     `lib/print/agent-presence.ts` probes when a repair desk is opened and
     starts the agent on the reader's first press if nothing answers. A
     dashboard nobody has open needs no agent, and the one program that cares
     is the one doing the looking.

     ** It still replaces the Startup shortcut this script used to make**, and
     the shortcut is still deleted here -- a task can be read, disabled and
     removed by name, where a shortcut is a file somebody has to find.

  2. The alesnad-print: protocol, which is how a web page starts a program on
     this PC at all. The browser asks "Open Al-Esnad print agent?" the first
     time; tick always-allow and it stops asking. Without it the agent can
     still be started by hand (start.cmd) and the dashboard will say so.

  3. It starts the agent now, so nobody has to sign out and back in.
#>
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$task = 'Al-Esnad print agent'
$protocol = 'HKCU:\Software\Classes\alesnad-print'
$ensure = Join-Path $here 'ensure.ps1'
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Al-Esnad print agent.lnk'

function Stop-Agent {
  try {
    $quit = [Net.WebRequest]::Create('http://127.0.0.1:17777/v1/quit')
    $quit.Method = 'POST'
    $quit.Timeout = 2500
    $quit.ContentLength = 0
    $quit.Headers.Add('X-Al-Esnad-Print', '1')
    $quit.GetRequestStream().Close()
    $quit.GetResponse().Close()
  } catch {
    # It was not running, which is where this was trying to get to anyway.
  }
}

if ($Remove) {
  Unregister-ScheduledTask -TaskName $task -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -Path $protocol -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -Path $startup -Force -ErrorAction SilentlyContinue
  Stop-Agent
  Write-Output "Removed the sign-in task and the alesnad-print: handler, and stopped the agent."
  Write-Output "install.cmd puts it all back."
  exit 0
}

if (Test-Path $startup) {
  Remove-Item -Path $startup -Force
  Write-Output "Removed the old Startup shortcut -- the scheduled task replaces it."
}

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $here `
  -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$ensure`""
# ⚠️ One trigger. There is deliberately no repetition: see the note at the
# top of this file, and `lib/print/agent-presence.ts` for what does the
# watching instead. Adding `-RepetitionInterval` back here is re-introducing
# the thing the shop asked to have removed.
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
# IgnoreNew: a start still waiting on a slow agent must not be joined by a
# second. Two minutes is many times ensure.ps1's own twenty-second wait, so
# the limit can only ever end a pass that has genuinely hung.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2)
# Interactive and Limited: it runs while somebody is signed in, which is the
# only time anything here prints, and it needs no rights beyond that person's.
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $task -Action $action -Trigger $atLogon `
  -Settings $settings -Principal $principal -Force `
  -Description 'Starts the Al-Esnad print agent when you sign in, so the repair desk prints with no dialog. The dashboard starts it again if it stops. See tools\print-agent\ensure.ps1.' | Out-Null
Write-Output "Registered the task '$task' -- at sign-in only, nothing on a timer."

New-Item -Path $protocol -Force | Out-Null
Set-ItemProperty -Path $protocol -Name '(Default)' -Value 'URL:Al-Esnad print agent'
Set-ItemProperty -Path $protocol -Name 'URL Protocol' -Value ''
$command = Join-Path $protocol 'shell\open\command'
New-Item -Path $command -Force | Out-Null
Set-ItemProperty -Path $command -Name '(Default)' `
  -Value ('powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $ensure + '" "%1"')
Write-Output "Registered alesnad-print: so the dashboard can start it again if it stops."

# Started, then asked -- and never asked of the exit code. Start-Process
# -PassThru reports -196608 for a script that plainly returned 0 (measured
# on this PC), so the only answer worth printing here is the port's own.
Start-Process -FilePath 'powershell.exe' -Wait -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $ensure
)
try {
  $probe = [Net.WebRequest]::Create('http://127.0.0.1:17777/v1/status')
  $probe.Timeout = 2500
  $probe.Headers.Add('X-Al-Esnad-Print', '1')
  $probe.GetResponse().Close()
  Write-Output "The print agent is running. The dashboard restarts it if it ever stops."
} catch {
  Write-Output "The agent did not start. Its log is %LOCALAPPDATA%\AlEsnadPrint\agent.log"
}
