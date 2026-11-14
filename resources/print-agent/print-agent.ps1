<#
  The Al-Esnad print agent.

  Lets the repair desk print with no dialog: the dashboard, open in the
  browser on this PC, asks this agent to send each paper to a named Windows
  printer. It uses only what Windows already has — PowerShell and the .NET
  Framework — so nothing is installed.

  Run it with start.cmd (or install.cmd, which also starts it with Windows).
  It listens on http://127.0.0.1:17777 and answers only the shop's own site.
  Its log is %LOCALAPPDATA%\AlEsnadPrint\agent.log.

  To let another address drive it (a staging copy of the site, say), put one
  origin per line in origins.txt beside this file, or set
  AL_ESNAD_PRINT_ORIGINS to a comma-separated list.
#>
param([int]$Port = 17777)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$origins = @(
  'https://alisnad.iq',
  'https://www.alisnad.iq',
  'http://localhost:3000',
  'http://localhost:3100',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3100'
)
if ($env:AL_ESNAD_PRINT_ORIGINS) {
  $origins += $env:AL_ESNAD_PRINT_ORIGINS -split '[,\s]+' | Where-Object { $_ }
}
$extra = Join-Path $here 'origins.txt'
if (Test-Path $extra) {
  $origins += Get-Content $extra | ForEach-Object { $_.Trim() } | Where-Object { $_ -and -not $_.StartsWith('#') }
}

$logDir = Join-Path $env:LOCALAPPDATA 'AlEsnadPrint'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null

Add-Type -AssemblyName System.Drawing
$serializer = [Reflection.Assembly]::LoadWithPartialName('System.Web.Extensions')
$csPath = Join-Path $here 'PrintAgent.cs'
$source = Get-Content -Raw -Encoding UTF8 -Path $csPath
$refs = @('System.Drawing', $serializer.Location)

<#
  The compile is the slow half of a start. Add-Type shells out to csc for
  this file on every launch and throws the result away when the process
  ends, so each start pays for it again. Measured on the counter PC: a start
  that has to compile is listening after 5.9 seconds, one that finds this
  cache after 2.3 -- and nearly all of the 2.3 is PowerShell itself starting.

  That difference is what lets a press on "print" start the agent rather than
  report that it is not running.

  The file name carries the source's own hash, so an edited PrintAgent.cs is
  compiled once more and a stale build can never be loaded by mistake.

  ** Add-Type -OutputAssembly writes the file and does NOT load the type**,
  so the load that follows is the only one, not a duplicate. And every step
  falls back to compiling in memory: a cache that cannot be written or read
  -- two copies starting at once, a locked file, a full disk -- must cost a
  slow start and never a start that did not happen.
#>
$log = Join-Path $logDir 'agent.log'
function Note([string]$line) {
  try { Add-Content -Path $log -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '  ' + $line) } catch { }
}

$dll = Join-Path $logDir ('PrintAgent-' + (Get-FileHash -Algorithm SHA256 -Path $csPath).Hash.Substring(0, 16) + '.dll')
$loaded = $false
if (Test-Path $dll) {
  try { Add-Type -Path $dll; $loaded = $true } catch { Note ("cache: could not load " + $dll + " - " + $_.Exception.Message) }
}
if (-not $loaded) {
  try {
    Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies $refs -OutputAssembly $dll
    Add-Type -Path $dll
    $loaded = $true
    Note ("cache: compiled " + (Split-Path -Leaf $dll))
    Get-ChildItem -Path $logDir -Filter 'PrintAgent-*.dll' |
      Where-Object { $_.FullName -ne $dll } |
      Remove-Item -Force -ErrorAction SilentlyContinue
  } catch {
    Note ("cache: could not compile to a file, starting the slow way - " + $_.Exception.Message)
  }
}
if (-not $loaded) {
  Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies $refs
}

exit [AlEsnadPrint.Agent]::Run($Port, [string[]]$origins, (Join-Path $logDir 'agent.log'))
