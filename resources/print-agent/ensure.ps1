<#
  Starts the Al-Esnad print agent, but only if it is not already running.

  Called three ways, and it does the same thing each time:

    - the scheduled task "Al-Esnad print agent" runs it once, at logon, so the
      agent is usually listening before anybody asks it for anything;
    - the alesnad-print: protocol runs it when the DASHBOARD asks -- which is
      what keeps the agent up for the rest of the day. See
      `lib/print/agent-presence.ts`: the repair desk probes the port when it
      is opened, and starts the agent on the reader's first press if nothing
      answers;
    - install.ps1 runs it once at the end, to start it there and then.

  ** There is deliberately nothing on a timer.** This ran every three minutes
  for a week and the shop asked for it to stop: a probe at a port is cheap,
  and a whole PowerShell start to make that probe, twenty times an hour, on a
  PC that is also running the till, is not. The dashboard does the watching
  now, because it is the only program that needs the answer.

  It still probes before it starts. The agent exits with 2 when the port is
  already taken, so a second copy is harmless -- but it writes a line to the
  log on the way out, and something firing repeatedly would bury the one line
  that mattered under its own noise.
#>
param([string]$Url)  # the protocol handler passes the URL. Nothing reads it.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 17777

<#
  The test is "has anything taken the port", by TCP, and deliberately NOT an
  HTTP request.

  ** A closed loopback port does not always refuse on this PC -- measured.**
  It hangs, so a WebRequest sat on its own timeout instead of failing at
  once, and a loop of fifty probes that should have taken twenty seconds took
  over ninety. An asynchronous connect with its own short wait is the only
  version whose cost is knowable.

  TCP is also the right question. Only the agent binds 17777, so a port that
  accepts is an agent -- and if something else ever took it, starting a second
  copy would fail anyway. An HTTP probe would additionally have to carry the
  X-Al-Esnad-Print header and read a 403 as "not running", which is a way to
  wait out a perfectly healthy agent.
#>
function Test-Agent {
  $client = New-Object Net.Sockets.TcpClient
  try {
    $connect = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    if (-not $connect.AsyncWaitHandle.WaitOne(400)) { return $false }
    $client.EndConnect($connect)
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

if (Test-Agent) { exit 0 }

try {
  $log = Join-Path $env:LOCALAPPDATA 'AlEsnadPrint\agent.log'
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $log) | Out-Null
  Add-Content -Path $log -Value ('{0}  watchdog: not answering, starting the agent' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))
} catch {
  # A log that cannot be written is not a reason not to print.
}

Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -WorkingDirectory $here -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
  '-File', (Join-Path $here 'print-agent.ps1')
)

<#
  Wait for the port, so whoever called this can print the moment it returns.

  ** Forty-five seconds, and the earlier twenty was too short.** A start on an
  idle PC is 5.9 seconds when it has to compile the agent's C# and 2.3 when it
  finds the cached assembly -- and those are a best case, not a budget.
  Measured again on 2026-11-12 with a Next.js build, a dev server and a
  headless browser running: ask at 19:09:10, listening at 19:09:45. **Thirty-
  five seconds**, on the same machine, with the same cached assembly. A
  deadline that expires while the agent is still coming up reports a failure
  about something that is about to work, and the wait costs nothing in the
  ordinary case because the probe returns the moment the port answers.

  It is a deadline rather than a count of attempts: a loop counting attempts
  has no idea how long it has actually been waiting.
#>
$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 250
  if (Test-Agent) { exit 0 }
}
exit 1
