# Is this PC set up to print from the repair desk, and is the agent up?
#
# Read-only: it registers nothing, starts nothing and changes nothing. It
# exists because the three pieces fail silently and separately, and until now
# there was no way to see which one was missing without reading the registry
# by hand.
#
# What it cost not to have: the counter PC ran for a week with NOTHING
# registered -- no task, no protocol -- so every press of «طباعة» asked
# Windows to open `alesnad-print:` and Windows, never having heard of it,
# stayed on the page and said nothing. The dashboard reported "the print agent
# is not running", which is true and is the wrong sentence: it sends somebody
# to start a program on a machine where the program was never set up. Nobody
# could have known, because nothing anywhere printed these three lines.
#
# Run it from status.cmd, or: powershell -ExecutionPolicy Bypass -File status.ps1

$ErrorActionPreference = 'SilentlyContinue'

$task     = 'Al-Esnad print agent'
$protocol = 'HKCU:\Software\Classes\alesnad-print'
$log      = Join-Path $env:LOCALAPPDATA 'AlEsnadPrint\agent.log'

Write-Output ''
Write-Output "Al-Esnad print agent -- setup on $env:COMPUTERNAME"
Write-Output '--------------------------------------------------------------'

# 1. The protocol. This is the one that matters most: it is the only way a
#    web page can start a program, so without it the dashboard can probe the
#    agent and can never bring it back.
$command = Get-ItemProperty -Path (Join-Path $protocol 'shell\open\command') -Name '(Default)'
if ($command) {
  Write-Output 'Protocol  alesnad-print:   REGISTERED'
} else {
  Write-Output 'Protocol  alesnad-print:   MISSING   <- the dashboard cannot start the agent'
}

# 2. The task, which only starts it at sign-in. Nothing is on a timer, by the
#    shop's instruction of 2026-11-12 -- the dashboard does the watching.
$job = Get-ScheduledTask -TaskName $task
if ($job) {
  $state = if ($job.State -eq 'Disabled') { 'DISABLED <- stop.cmd turned it off; start.cmd turns it back on' } else { 'at sign-in' }
  Write-Output "Task      '$task'  REGISTERED ($state)"
} else {
  Write-Output "Task      '$task'  MISSING   <- the agent will not start at sign-in"
}

# 3. The agent itself. A refusal still proves it is listening, so any answer
#    at all counts -- the same reasoning the page's own "has it ever answered"
#    test uses.
$up = $false
try {
  $probe = [Net.WebRequest]::Create('http://127.0.0.1:17777/v1/status')
  $probe.Timeout = 2500
  $probe.Headers.Add('X-Al-Esnad-Print', '1')
  $probe.GetResponse().Close()
  $up = $true
} catch {
  $up = $_.Exception.Response -ne $null
}
if ($up) {
  Write-Output 'Agent     127.0.0.1:17777  RUNNING'
} else {
  Write-Output 'Agent     127.0.0.1:17777  not running'
}

Write-Output '--------------------------------------------------------------'
if ($command -and $job) {
  if ($up) {
    Write-Output 'This PC is set up and printing should work.'
  } else {
    Write-Output 'This PC is set up. The agent is off; the dashboard starts it on your'
    Write-Output 'first press, or run start.cmd now.'
  }
} else {
  Write-Output 'This PC is NOT set up. Run install.cmd once -- it needs no administrator'
  Write-Output 'rights, and it is the step that makes the dashboard able to start the'
  Write-Output 'agent by itself afterwards.'
}
if (Test-Path $log) {
  Write-Output ''
  Write-Output "Log: $log"
}
Write-Output ''
