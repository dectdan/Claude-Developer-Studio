# run-sandbox-test.ps1 -- tests the built installer in Windows Sandbox as a brand-new user.
# Run on the host, no elevation needed:
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\sandbox-test\run-sandbox-test.ps1 [-TimeoutMinutes 60]
#
# Writes tools\sandbox-test\results\<run>\sandbox.wsb, launches it, waits for the sandbox
# to write results.json (finished), then prints the checks. The sandbox has networking
# disabled (the installer must be self-contained) and sees the installer folder and the
# test scripts read-only; only results\<run>\ is writable. The test script shuts the
# sandbox down when it is done. After the time limit the sandbox is closed and the run
# is reported as a timeout. Only one Windows Sandbox can run at a time.
#
# Exit codes: 0 all checks passed, 1 a check failed, 2 timeout, 3 could not start.

param(
    [string]$InstallerDir = (Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) 'Installer\Output'),
    [int]$TimeoutMinutes = 60
)

$ErrorActionPreference = 'Stop'
$Repo    = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Kit     = $PSScriptRoot
$McpTest = Join-Path $Repo 'mcp-server\test'
$Run     = Get-Date -Format 'yyyyMMdd-HHmmss'
$Results = Join-Path $Kit "results\$Run"
$SandboxProcs = 'WindowsSandbox', 'WindowsSandboxClient', 'WindowsSandboxRemoteSession', 'WindowsSandboxServer'

function Get-SandboxProcs { @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $SandboxProcs -contains $_.Name }) }
function Close-Sandbox {
    foreach ($p in Get-SandboxProcs) { try { Stop-Process -Id $p.Id -Force -ErrorAction Stop; Write-Host "  stopped $($p.Name) ($($p.Id))" } catch { Write-Host "  could not stop $($p.Name) ($($p.Id)): $($_.Exception.Message)" } }
}

$exe = Join-Path $env:windir 'System32\WindowsSandbox.exe'
if (-not (Test-Path $exe)) { Write-Host 'Windows Sandbox is not installed (optional feature Containers-DisposableClientVM).' -ForegroundColor Red; exit 3 }
$setup = Join-Path $InstallerDir 'ClaudeDevStudio-Setup.exe'
if (-not (Test-Path $setup)) { Write-Host "Installer not found: $setup (build it first)." -ForegroundColor Red; exit 3 }
if ((Get-SandboxProcs).Count -gt 0) { Write-Host 'A Windows Sandbox is already running; only one can run at a time. Close it first.' -ForegroundColor Red; exit 3 }

New-Item -ItemType Directory -Force -Path $Results | Out-Null
$esc = { param($s) [System.Security.SecurityElement]::Escape($s) }
$wsb = @"
<Configuration>
  <Networking>Disable</Networking>
  <vGPU>Disable</vGPU>
  <ClipboardRedirection>Disable</ClipboardRedirection>
  <MemoryInMB>6144</MemoryInMB>
  <MappedFolders>
    <MappedFolder><HostFolder>$(& $esc (Resolve-Path $InstallerDir).Path)</HostFolder><SandboxFolder>C:\cds\installer</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$(& $esc $Kit)</HostFolder><SandboxFolder>C:\cds\kit</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$(& $esc $McpTest)</HostFolder><SandboxFolder>C:\cds\mcptest</SandboxFolder><ReadOnly>true</ReadOnly></MappedFolder>
    <MappedFolder><HostFolder>$(& $esc $Results)</HostFolder><SandboxFolder>C:\cds\results</SandboxFolder><ReadOnly>false</ReadOnly></MappedFolder>
  </MappedFolders>
  <LogonCommand>
    <Command>powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\cds\kit\in-sandbox.ps1</Command>
  </LogonCommand>
</Configuration>
"@
$wsbPath = Join-Path $Results 'sandbox.wsb'
[System.IO.File]::WriteAllText($wsbPath, $wsb, (New-Object System.Text.UTF8Encoding $false))

$installerHash = (Get-FileHash $setup -Algorithm SHA256).Hash
Write-Host "Run $Run"
Write-Host "  Installer : $setup"
Write-Host "  SHA-256   : $installerHash"
Write-Host "  Results   : $Results"
Write-Host "  Time limit: $TimeoutMinutes min"
$started = Get-Date
Start-Process -FilePath $exe -ArgumentList "`"$wsbPath`""

$resultsFile = Join-Path $Results 'results.json'
$deadline = $started.AddMinutes($TimeoutMinutes)
$finished = $false
$lastCount = -1
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 15
    if (Test-Path $resultsFile) {
        try { $r = Get-Content $resultsFile -Raw | ConvertFrom-Json } catch { continue }
        $n = @($r.checks).Count
        if ($n -ne $lastCount) { Write-Host ("  {0:mm\:ss}  {1} checks so far ({2} failed)" -f ((Get-Date) - $started), $n, $r.failed); $lastCount = $n }
        if ($r.finished) { $finished = $true; break }
    } elseif (((Get-Date) - $started).TotalMinutes -gt 5 -and (Get-SandboxProcs).Count -eq 0) {
        Write-Host 'Windows Sandbox is not running and wrote no results: it could not start (is virtualization enabled?).' -ForegroundColor Red
        exit 3
    }
}

$elapsed = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
if (-not $finished) {
    Write-Host "TIMEOUT: no finished results after $TimeoutMinutes min; closing the sandbox." -ForegroundColor Red
    Close-Sandbox
    if (Test-Path $resultsFile) { Write-Host "Partial results: $resultsFile" }
    exit 2
}

# The test shuts the sandbox down itself (that can take a couple of minutes); then close it.
$waitUntil = (Get-Date).AddSeconds(180)
while ((Get-SandboxProcs).Count -gt 0 -and (Get-Date) -lt $waitUntil) { Start-Sleep -Seconds 5 }
if ((Get-SandboxProcs).Count -gt 0) { Write-Host 'The sandbox did not shut down by itself; closing it.'; Close-Sandbox }

$r = Get-Content $resultsFile -Raw | ConvertFrom-Json
Write-Host "`nResults ($elapsed min): $($r.passed) passed, $($r.failed) failed"
foreach ($c in $r.checks) {
    $color = if ($c.result -eq 'PASS') { 'Green' } else { 'Red' }
    Write-Host ("  {0}  [{1}] {2}" -f $c.result, $c.scenario, $c.name) -ForegroundColor $color
    if ($c.result -ne 'PASS') { Write-Host "        $($c.evidence)" }
}
if ($r.info.installerSha256 -and $r.info.installerSha256 -ne $installerHash) { Write-Host 'WARNING: the sandbox saw a different installer than the host.' -ForegroundColor Yellow }
if ($r.failed -gt 0) { exit 1 }
exit 0
