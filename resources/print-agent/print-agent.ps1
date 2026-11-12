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
$source = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $here 'PrintAgent.cs')
Add-Type -TypeDefinition $source -Language CSharp -ReferencedAssemblies @('System.Drawing', $serializer.Location)

exit [AlEsnadPrint.Agent]::Run($Port, [string[]]$origins, (Join-Path $logDir 'agent.log'))
