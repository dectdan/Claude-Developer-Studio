# deploy.ps1 -- developer tool: copies a fresh build of ClaudeDevStudio into the installed
# copy (%LOCALAPPDATA%\ClaudeDevStudio) without running the installer.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy.ps1 -DryRun   (lists, changes nothing)
#   powershell -NoProfile -ExecutionPolicy Bypass -File deploy.ps1
#
# It copies: the CLI's whole build output (published fresh from the source), mcp-server\
# index.js, workbench.js, cds-paths.js (both servers import it), package.json,
# package-lock.json, templates\*.md (claudedev_scaffold's), and the Review Panel's
# server.js, package.json, package-lock.json. Only files whose content differs are copied;
# each file it replaces is backed up first under _deploy_backups\<time>\ in the installed copy.
# It never touches the user's API keys file or Claude Desktop's config: only the files
# listed above are ever written.

param(
    [string]$Src = $PSScriptRoot,
    [string]$Dst = (Join-Path $env:LOCALAPPDATA 'ClaudeDevStudio'),
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$stamp     = Get-Date -Format 'yyyyMMdd_HHmm'
$BackupDir = Join-Path $Dst "_deploy_backups\$stamp"
$Deployed  = New-Object System.Collections.Generic.List[string]
$Same      = 0
$tag       = if ($DryRun) { '[DRY] ' } else { '' }

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   !!  $msg" -ForegroundColor Yellow }

# Copies one file if its content differs; backs up the file it replaces.
function Deploy-File([string]$SrcFile, [string]$DstRel) {
    $d = Join-Path $Dst $DstRel
    if (Test-Path -LiteralPath $d) {
        if ((Get-FileHash -LiteralPath $SrcFile).Hash -eq (Get-FileHash -LiteralPath $d).Hash) { $script:Same++; return }
        if (-not $DryRun) {
            $b = Join-Path $BackupDir $DstRel
            New-Item -ItemType Directory -Force -Path (Split-Path $b -Parent) | Out-Null
            Copy-Item -LiteralPath $d $b
        }
        Write-Ok "$tag$DstRel  (replaced; backup in _deploy_backups\$stamp)"
    } else {
        Write-Ok "$tag$DstRel  (new)"
    }
    if (-not $DryRun) {
        New-Item -ItemType Directory -Force -Path (Split-Path $d -Parent) | Out-Null
        Copy-Item -LiteralPath $SrcFile $d -Force
    }
    $script:Deployed.Add($DstRel)
}

if (-not (Test-Path (Join-Path $Src 'ClaudeDevStudio.csproj'))) { Write-Host "ERROR: not the ClaudeDevStudio source: $Src" -ForegroundColor Red; exit 1 }
if (-not (Test-Path $Dst)) { Write-Host "ERROR: no installed copy at $Dst. Install ClaudeDevStudio with the installer first." -ForegroundColor Red; exit 1 }

Write-Host "`nCDS Deploy" -ForegroundColor Magenta
Write-Host "  Source : $Src"
Write-Host "  Target : $Dst"
if ($DryRun) { Write-Host '  Mode   : DRY RUN (nothing is copied, stopped or installed)' -ForegroundColor Yellow }

# ---- CLI: publish fresh into a staging folder, then copy all of it ----
Write-Step 'CLI (dotnet publish, Release)'
$cliStage = Join-Path ([System.IO.Path]::GetTempPath()) "cds-deploy-cli-$stamp"
if (Test-Path $cliStage) { Remove-Item $cliStage -Recurse -Force }
$ErrorActionPreference = 'Continue'
$pub = & dotnet publish (Join-Path $Src 'ClaudeDevStudio.csproj') -c Release -r win-x64 --self-contained false -o $cliStage -nologo -v:quiet 2>&1
$pubCode = $LASTEXITCODE
$ErrorActionPreference = 'Stop'
if ($pubCode -ne 0) { $pub | Select-Object -Last 20 | ForEach-Object { Write-Host "   $_" }; Write-Host 'ERROR: the CLI did not build; nothing deployed.' -ForegroundColor Red; exit 1 }
foreach ($f in Get-ChildItem $cliStage -Recurse -File) {
    Deploy-File $f.FullName (Join-Path 'CLI' $f.FullName.Substring($cliStage.Length).TrimStart('\'))
}
Remove-Item $cliStage -Recurse -Force

# ---- Both MCP servers ----
Write-Step 'MCP servers'
foreach ($f in 'index.js', 'workbench.js', 'cds-paths.js', 'package.json', 'package-lock.json',
              'templates\GROUND_TRUTH.md', 'templates\CONVENTIONS.md', 'templates\HOW_WE_WORK.md') {
    Deploy-File (Join-Path $Src "mcp-server\$f") "mcp-server\$f"
}

# ---- Review Panel ----
Write-Step 'Review Panel'
foreach ($f in 'server.js', 'package.json', 'package-lock.json') {
    Deploy-File (Join-Path $Src "review-server\$f") "review-server\$f"
}

# ---- Dependencies, only when a package file changed ----
foreach ($dir in 'mcp-server', 'review-server') {
    if ($Deployed -contains "$dir\package.json" -or $Deployed -contains "$dir\package-lock.json") {
        Write-Step "$dir dependencies"
        if ($DryRun) { Write-Host "   [DRY] would run npm ci --omit=dev in $dir" -ForegroundColor Yellow }
        else {
            Push-Location (Join-Path $Dst $dir)
            try { & npm.cmd ci --omit=dev --no-audit --no-fund; if ($LASTEXITCODE -ne 0) { Write-Warn "npm ci failed in $dir" } else { Write-Ok "npm ci in $dir" } }
            finally { Pop-Location }
        }
    }
}

# ---- Summary ----
Write-Host "`n-----------------------------------------" -ForegroundColor DarkGray
if ($Deployed.Count -gt 0) {
    Write-Host "$(if ($DryRun) { 'Would deploy' } else { 'Deployed' }) $($Deployed.Count) file(s); $Same already the same." -ForegroundColor Green
} else {
    Write-Host "Nothing to deploy: all $Same files are already the same." -ForegroundColor DarkGray
}
if (($Deployed | Where-Object { $_ -like 'review-server\*' }) -and -not $DryRun) {
    Write-Host 'The Review Panel loads the new files when it next starts (stop the node process on port 63000, or restart the PC).' -ForegroundColor Yellow
}
Write-Host "`nQuit Claude Desktop fully and reopen it." -ForegroundColor Yellow
