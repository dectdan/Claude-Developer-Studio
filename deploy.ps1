param(
    [string]$Src = "D:\Projects\ClaudeDevStudio",
    [switch]$DryRun
)

$Dst      = "$env:LOCALAPPDATA\ClaudeDevStudio"
$Deployed = @()
$Skipped  = @()

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Skip($msg) { Write-Host "   --  $msg" -ForegroundColor DarkGray }
function Write-Warn($msg) { Write-Host "   !!  $msg" -ForegroundColor Yellow }

function Deploy-File($srcRel, $dstRel = $null) {
    if (-not $dstRel) { $dstRel = $srcRel }
    $s = Join-Path $Src $srcRel
    $d = Join-Path $Dst $dstRel
    if (-not (Test-Path $s)) { Write-Warn "Source not found: $srcRel"; return }
    $dDir = Split-Path $d -Parent
    if (-not (Test-Path $dDir)) {
        if (-not $DryRun) { New-Item -ItemType Directory -Path $dDir -Force | Out-Null }
        Write-Ok "Created dir: $dDir"
    }
    $copy = $true
    if (Test-Path $d) {
        $srcTime = (Get-Item $s).LastWriteTimeUtc
        $dstTime = (Get-Item $d).LastWriteTimeUtc
        if ($srcTime -le $dstTime) {
            Write-Skip $dstRel
            $script:Skipped += $dstRel
            $copy = $false
        }
    }
    if ($copy) {
        if (-not $DryRun) { Copy-Item $s $d -Force }
        $tag = if ($DryRun) { "[DRY] " } else { "" }
        Write-Ok "$tag$dstRel"
        $script:Deployed += $dstRel
    }
}

# Deploy all changed files from a source folder to a dest folder (flat, no recurse into subdirs)
function Deploy-Dir($srcSubdir, $dstSubdir, [string[]]$ExcludeNames = @()) {
    $srcDir = Join-Path $Src $srcSubdir
    $dstDir = Join-Path $Dst $dstSubdir
    if (-not (Test-Path $srcDir)) { Write-Warn "Source dir not found: $srcSubdir"; return }
    if (-not (Test-Path $dstDir) -and -not $DryRun) { New-Item -ItemType Directory $dstDir -Force | Out-Null }
    foreach ($f in Get-ChildItem $srcDir -File) {
        if ($ExcludeNames -contains $f.Name) { Write-Skip "$dstSubdir\$($f.Name)"; continue }
        $d = Join-Path $dstDir $f.Name
        $copy = $true
        if (Test-Path $d) {
            if ($f.LastWriteTimeUtc -le (Get-Item $d).LastWriteTimeUtc) {
                Write-Skip "$dstSubdir\$($f.Name)"; $script:Skipped += "$dstSubdir\$($f.Name)"; $copy = $false
            }
        }
        if ($copy) {
            if (-not $DryRun) { Copy-Item $f.FullName $d -Force }
            $tag = if ($DryRun) { "[DRY] " } else { "" }
            Write-Ok "$tag$dstSubdir\$($f.Name)"; $script:Deployed += "$dstSubdir\$($f.Name)"
        }
    }
}

if (-not (Test-Path $Src)) {
    Write-Host "ERROR: Source not found: $Src" -ForegroundColor Red; exit 1
}
if (-not (Test-Path $Dst)) {
    Write-Host "ERROR: AppData install not found: $Dst" -ForegroundColor Red
    Write-Host "Run install.ps1 first on a fresh machine." -ForegroundColor Yellow
    exit 1
}

Write-Host "`nCDS Deploy" -ForegroundColor Magenta
Write-Host "  Source : $Src"
Write-Host "  Target : $Dst"
if ($DryRun) { Write-Host "  Mode   : DRY RUN" -ForegroundColor Yellow }

Write-Step "CLI binary (claudedev.exe)"
$cliBuild = "bin\Release\net8.0\claudedev.exe"
if (-not (Test-Path (Join-Path $Src $cliBuild))) {
    Write-Warn "claudedev.exe not built. Run: dotnet build -c Release"
    Write-Warn "Skipping CLI deploy."
} else {
    Deploy-File $cliBuild "CLI\claudedev.exe"
    Deploy-File $cliBuild "mcp-server\claudedev.exe"
}

Write-Step "MCP server files"
Deploy-File "mcp-server\index.js"
Deploy-File "mcp-server\qwen_config.json"

Write-Step "Review Panel files"
Deploy-File "review-server\server.js"
Deploy-File "review-server\package.json"

Write-Step "Review Panel dependencies"
$rvMod       = Join-Path $Dst "review-server\node_modules"
$needInstall = (-not (Test-Path $rvMod)) -or ("review-server\package.json" -in $Deployed)
if ($needInstall -and -not $DryRun) {
    Push-Location (Join-Path $Dst "review-server")
    npm install --silent 2>&1 | Out-Null
    Pop-Location
    Write-Ok "npm install complete"
} elseif ($needInstall -and $DryRun) {
    Write-Host "   [DRY] Would run npm install" -ForegroundColor Yellow
} else {
    Write-Skip "node_modules up to date"
}

Write-Step "Restart Review Panel"
if (-not $DryRun) {
    $listening = netstat -ano | Select-String ":63000 "
    if ($listening) {
        $oldPid = ($listening -split '\s+')[-1]
        Stop-Process -Id ([int]$oldPid) -Force -ErrorAction SilentlyContinue
        Write-Ok "Stopped old server (PID $oldPid)"
        Start-Sleep -Milliseconds 500
    }
    $serverJs = Join-Path $Dst "review-server\server.js"
    if (Test-Path $serverJs) {
        $proc = Start-Process -FilePath "node" -ArgumentList $serverJs -WindowStyle Hidden -PassThru
        Write-Ok "Started review server (PID $($proc.Id)) at http://localhost:63000"
    } else {
        Write-Warn "review-server\server.js not in AppData yet - run again after first deploy"
    }
} else {
    Write-Host "   [DRY] Would restart review server" -ForegroundColor Yellow
}

Write-Step "TrayApp binaries"
$trayBuildDir = "ClaudeDevStudio.UI\bin\Release\net8.0-windows"
if (-not (Test-Path (Join-Path $Src $trayBuildDir))) {
    Write-Warn "TrayApp not built. Run: dotnet build ClaudeDevStudio.UI -c Release"
    Write-Warn "Skipping TrayApp deploy."
} else {
    $trayFiles = @("ClaudeDevStudio.TrayApp.exe","ClaudeDevStudio.TrayApp.dll",
                   "ClaudeDevStudio.TrayApp.deps.json","ClaudeDevStudio.TrayApp.runtimeconfig.json")
    $trayChanged = $false
    foreach ($f in $trayFiles) { 
        Deploy-File "$trayBuildDir\$f" "TrayApp\$f"
        if ("TrayApp\$f" -in $script:Deployed) { $trayChanged = $true }
    }
    if ($trayChanged -and -not $DryRun) {
        Write-Step "Restart TrayApp"
        $trayProc = Get-Process -Name "ClaudeDevStudio.TrayApp" -ErrorAction SilentlyContinue
        if ($trayProc) {
            Stop-Process -Id $trayProc.Id -Force
            Start-Sleep -Milliseconds 800
            Write-Ok "Stopped TrayApp (PID $($trayProc.Id))"
        }
        $trayExe = Join-Path $Dst "TrayApp\ClaudeDevStudio.TrayApp.exe"
        Start-Process $trayExe -WindowStyle Hidden
        Write-Ok "TrayApp restarted from $trayExe"
    } elseif ($trayChanged -and $DryRun) {
        Write-Host "   [DRY] Would restart TrayApp" -ForegroundColor Yellow
    } else {
        Write-Skip "TrayApp unchanged - no restart needed"
    }
}

Write-Step "VoiceServer binaries"
$vsBuildDir = "VoiceServer\bin\Release\net8.0\win-x64"
if (-not (Test-Path (Join-Path $Src $vsBuildDir))) {
    Write-Warn "VoiceServer not built. Run: dotnet build VoiceServer -c Release -r win-x64"
    Write-Warn "Skipping VoiceServer deploy."
} else {
    # Deploy all files from build output; large assets (kokoro.onnx, runtimes/, voices/, espeak/)
    # only exist in AppData - they are never overwritten here.
    $vsExclude = @("kokoro.onnx")   # safety net; this file is not in build output anyway
    Deploy-Dir $vsBuildDir "VoiceServer" $vsExclude
    Write-Skip "VoiceServer assets (kokoro.onnx / runtimes / voices / espeak) - not touched"
}

Write-Host "`n-----------------------------------------" -ForegroundColor DarkGray
if ($Deployed.Count -gt 0) {
    Write-Host "Deployed $($Deployed.Count) file(s):" -ForegroundColor Green
    $Deployed | ForEach-Object { Write-Host "  + $_" -ForegroundColor Green }
} else {
    Write-Host "Nothing to deploy - all files up to date." -ForegroundColor DarkGray
}
if ($Skipped.Count -gt 0) {
    Write-Host "Skipped $($Skipped.Count) unchanged." -ForegroundColor DarkGray
}

$mcpChanged = $Deployed | Where-Object { $_ -eq "mcp-server\index.js" }
if ($mcpChanged -and -not $DryRun) {
    Write-Host "`nRestart Claude Desktop to reload the MCP server." -ForegroundColor Yellow
} elseif ($Deployed.Count -eq 0) {
    Write-Host "`nAll good. No restart needed." -ForegroundColor Green
}
