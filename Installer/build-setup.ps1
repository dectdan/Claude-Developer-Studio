# build-setup.ps1 -- Build Installer\Output\ClaudeDevStudio-Setup.exe from the source.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File Installer\build-setup.ps1
#
# Requires: .NET 8 SDK, Node.js + npm, NSIS (choco install nsis -y), and Visual Studio or
# Build Tools 2022+ with MSBuild and the VS extension SDK (for the VS Bridge VSIX).
# Downloads (Node.js MSI, .NET 8 Desktop Runtime, Windows App Runtime) are kept in
# Installer\downloads\ and reused; each must carry a valid Authenticode signature.
# Any failed step stops the build: nothing is skipped silently.

$ErrorActionPreference = 'Stop'
$Installer = $PSScriptRoot
$Root      = Split-Path -Parent $Installer
$Build     = Join-Path $Installer 'build'
$Output    = Join-Path $Installer 'Output'
$Downloads = Join-Path $Installer 'downloads'
$started   = Get-Date

function Step([string]$Text) { Write-Host "`n$Text" -ForegroundColor Yellow }
function Ok([string]$Text)   { Write-Host "  $Text" -ForegroundColor Green }
function Fail([string]$Text) { Write-Host "ERROR: $Text" -ForegroundColor Red; exit 1 }

# Runs a native command; stops the build if it fails. Prints the MSBuild summary lines.
function Run([string]$What, [string]$Exe, [string[]]$ArgList) {
    # Windows PowerShell stops on a native tool's stderr line under 'Stop'; judge by exit code.
    $ErrorActionPreference = 'Continue'
    $out = & $Exe @ArgList 2>&1 | ForEach-Object { "$_" }
    $code = $LASTEXITCODE
    $out | Where-Object { $_ -match '^\s*\d+ (Warning|Error)\(s\)' -or $_ -match ': error ' } | ForEach-Object { Write-Host "  $_" }
    if ($code -ne 0) { $out | Select-Object -Last 40 | ForEach-Object { Write-Host "  $_" }; Fail "$What failed (exit $code)" }
    Ok "$What`: OK"
}

Write-Host '===== ClaudeDevStudio NSIS Installer Build =====' -ForegroundColor Cyan
Write-Host "  Source: $Root"

# ---- 0. Tools ----
$makensis = Join-Path ${env:ProgramFiles(x86)} 'NSIS\makensis.exe'
if (-not (Test-Path $makensis)) { Fail 'NSIS not found. Run as admin: choco install nsis -y' }
Ok "NSIS: $makensis"

$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$msbuild = $null
if (Test-Path $vswhere) {
    $msbuild = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -find 'MSBuild\**\Bin\MSBuild.exe' | Select-Object -First 1
}
if (-not $msbuild -or -not (Test-Path $msbuild)) { Fail 'MSBuild not found (Visual Studio or Build Tools 2022+ is needed for the VSIX)' }
Ok "MSBuild: $msbuild"

foreach ($tool in 'dotnet', 'npm.cmd') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { Fail "$tool not found on PATH" }
}

# ---- Clean the staging folder (downloads are kept elsewhere) ----
if (Test-Path $Build) { Remove-Item $Build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Build, $Output, $Downloads | Out-Null

# ---- 1-3. CLI, TrayApp, Dashboard ----
Step '[1/7] CLI'
Run 'CLI' 'dotnet' @('publish', (Join-Path $Root 'ClaudeDevStudio.csproj'), '-c', 'Release', '-r', 'win-x64', '--self-contained', 'false', '-o', (Join-Path $Build 'CLI'))

Step '[2/7] TrayApp'
Run 'TrayApp' 'dotnet' @('publish', (Join-Path $Root 'ClaudeDevStudio.UI\ClaudeDevStudio.TrayApp.csproj'), '-c', 'Release', '-r', 'win-x64', '--self-contained', 'false', '-o', (Join-Path $Build 'TrayApp'))

Step '[3/7] Dashboard'
Run 'Dashboard' 'dotnet' @('publish', (Join-Path $Root 'ClaudeDevStudio.Dashboard\ClaudeDevStudio.Dashboard.csproj'), '-c', 'Release', '-r', 'win-x64', '--self-contained', 'false', '-o', (Join-Path $Build 'Dashboard'))

# ---- 4. VS Bridge VSIX (Visual Studio's MSBuild; dotnet build can't build it) ----
Step '[4/7] VS Bridge VSIX'
Run 'VSIX' $msbuild @((Join-Path $Root 'VSExtension\CdsVsBridge\CdsVsBridge.csproj'), '-restore', '-t:Rebuild', '-p:Configuration=Release', '-p:DeployExtension=false', '-v:minimal', '-nologo')
$vsix = Join-Path $Root 'VSExtension\CdsVsBridge\bin\Release\CdsVsBridge.vsix'
if (-not (Test-Path $vsix)) { Fail "VSIX not found after the build: $vsix" }
New-Item -ItemType Directory -Force -Path (Join-Path $Build 'VSExtension') | Out-Null
Copy-Item $vsix (Join-Path $Build 'VSExtension\CdsVsBridge.vsix')
Ok 'VSIX staged'

# ---- 5. Both MCP servers, the Review Panel, the installer's helper scripts ----
Step '[5/7] MCP servers, Review Panel, scripts'
$mcpSrc  = Join-Path $Root 'mcp-server'
$mcpDest = Join-Path $Build 'mcp-server'
New-Item -ItemType Directory -Force -Path $mcpDest | Out-Null
foreach ($f in 'index.js', 'workbench.js', 'cds-paths.js', 'cds-context.js', 'cds-hook.js', 'cds-search.js', 'cds-phase.js', 'package.json', 'package-lock.json', 'manifest.json', 'qwen_config.template.json') {
    Copy-Item (Join-Path $mcpSrc $f) $mcpDest
}
# The scaffold's templates (claudedev_scaffold); setup.nsi installs the staged folder recursively.
New-Item -ItemType Directory -Force -Path (Join-Path $mcpDest 'templates') | Out-Null
foreach ($f in 'GROUND_TRUTH.md', 'CONVENTIONS.md', 'HOW_WE_WORK.md') {
    Copy-Item (Join-Path $mcpSrc "templates\$f") (Join-Path $mcpDest 'templates')
}
# The keys file is created from the template at install time, only if it doesn't exist.
if (Test-Path (Join-Path $mcpDest 'qwen_config.json')) { Fail 'qwen_config.json must never be staged' }
Push-Location $mcpDest
try { Run 'mcp-server npm ci' 'npm.cmd' @('ci', '--omit=dev', '--no-audit', '--no-fund') } finally { Pop-Location }

$rvSrc  = Join-Path $Root 'review-server'
$rvDest = Join-Path $Build 'review-server'
New-Item -ItemType Directory -Force -Path $rvDest | Out-Null
foreach ($f in 'server.js', 'package.json', 'package-lock.json') { Copy-Item (Join-Path $rvSrc $f) $rvDest }
Push-Location $rvDest
try { Run 'review-server npm ci' 'npm.cmd' @('ci', '--omit=dev', '--no-audit', '--no-fund') } finally { Pop-Location }

foreach ($f in 'cds-config.js', 'cds-claude-code.js', 'cds-vsix.ps1', 'cds-path.ps1') { Copy-Item (Join-Path $Installer $f) $Build }
Ok 'Staged'

# ---- 6. Runtimes the installer bundles (so it installs with no network) ----
Step '[6/7] Bundled runtimes'
# Node.js: the Active LTS line's latest release (v26 "Lithium", LTS from 2026-10-28; checked on
# nodejs.org/dist/index.json 2026-11-11). Installed only when the PC has no Node.js.
$NodeVersion = '26.13.1'
# Cache: the downloaded file's own name (a new version is downloaded, never an old one reused);
# File: the name setup.nsi installs it from.
$bundles = @(
    @{ Name = "Node.js $NodeVersion LTS";     Cache = "node-v$NodeVersion-x64.msi";     File = 'node-lts-x64.msi';                 Url = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-x64.msi"; Sums = "https://nodejs.org/dist/v$NodeVersion/SHASUMS256.txt" },
    @{ Name = '.NET 8 Desktop Runtime';       Cache = 'windowsdesktop-runtime-8-x64.exe'; File = 'windowsdesktop-runtime-8-x64.exe'; Url = 'https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe' },
    @{ Name = 'Windows App Runtime 1.8';      Cache = 'WinAppRuntime.exe';                File = 'WinAppRuntime.exe';                Url = 'https://aka.ms/windowsappsdk/1.8/latest/windowsappruntimeinstall-x64.exe' }
)
foreach ($b in $bundles) {
    $cached = Join-Path $Downloads $b.Cache
    if (Test-Path $cached) {
        Write-Host "  $($b.Name): cached"
    } else {
        Write-Host "  $($b.Name): downloading $($b.Url)"
        Invoke-WebRequest -Uri $b.Url -OutFile $cached -UseBasicParsing
        if ($b.Sums) {
            # Node.js publishes SHA-256 sums beside each release: the download must match.
            $sums = (Invoke-WebRequest -Uri $b.Sums -UseBasicParsing).Content -split "`n"
            $want = ($sums | Where-Object { $_ -match "\s$([regex]::Escape($b.Cache))\s*$" } | ForEach-Object { ($_ -split '\s+')[0] }) | Select-Object -First 1
            $got = (Get-FileHash $cached -Algorithm SHA256).Hash
            if (-not $want -or $got -ne $want.ToUpper()) { Remove-Item $cached -Force; Fail "$($b.Cache): SHA-256 $got does not match SHASUMS256.txt ($want); deleted it" }
            Ok "$($b.Cache): SHA-256 matches SHASUMS256.txt"
        }
    }
    $sig = Get-AuthenticodeSignature -FilePath $cached
    if ($sig.Status -ne 'Valid') { Remove-Item $cached -Force; Fail "$($b.Cache): signature $($sig.Status); deleted it, run the build again" }
    Copy-Item $cached (Join-Path $Build $b.File)
    Ok "$($b.Name): signed by $($sig.SignerCertificate.GetNameInfo('SimpleName', $false))"
}

# ---- Versions must agree before anything is compiled into the installer ----
Step 'Versions'
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root 'tools\check-versions.ps1')
if ($LASTEXITCODE -ne 0) { Fail 'tools\check-versions.ps1 found a version that differs' }

# ---- 7. NSIS ----
Step '[7/7] Compiling the installer (NSIS, takes several minutes)'
$nsisArgs = @('/V2')
if (Test-Path (Join-Path $Installer 'Assets\AppIcon.ico')) { $nsisArgs += '/DHAVE_ICON' }
$nsisArgs += 'setup.nsi'
Push-Location $Installer
try { Run 'NSIS' $makensis $nsisArgs } finally { Pop-Location }

# ---- Report ----
$exe = Join-Path $Output 'ClaudeDevStudio-Setup.exe'
if (-not (Test-Path $exe)) { Fail 'EXE not found after the build' }
$item = Get-Item $exe
$hash = (Get-FileHash $exe -Algorithm SHA256).Hash
$mins = [math]::Round(((Get-Date) - $started).TotalMinutes, 1)
Write-Host "`n===== BUILD COMPLETE =====" -ForegroundColor Cyan
Write-Host "  Output : $exe"
Write-Host "  Size   : $($item.Length) bytes ($([math]::Round($item.Length / 1MB, 1)) MB)"
Write-Host "  SHA-256: $hash"
Write-Host "  Built  : $($item.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')) in $mins min"
