<#
.SYNOPSIS
  CDS Install - sets up ClaudeDevStudio on a fresh machine.

.DESCRIPTION
  Run once after cloning the repo on a new machine.
  Requires: Node.js 18+ and Claude Desktop installed.

.EXAMPLE
  cd D:\Projects\ClaudeDevStudio
  .\install.ps1
#>
param(
    [string]$Src = $PSScriptRoot
)

$Dst        = "$env:LOCALAPPDATA\ClaudeDevStudio"
$ConfigFile = "$env:APPDATA\Claude\claude_desktop_config.json"
$Errors     = 0

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "   !!  $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "   XX  $msg" -ForegroundColor Red; $script:Errors++ }

function Copy-Safe($s, $d) {
    $dDir = Split-Path $d -Parent
    if (-not (Test-Path $dDir)) { New-Item -ItemType Directory $dDir -Force | Out-Null }
    if (Test-Path $s) { Copy-Item $s $d -Force; Write-Ok (Split-Path $d -Leaf) }
    else              { Write-Fail "Source missing: $s" }
}

Write-Host "`nCDS Install" -ForegroundColor Magenta
Write-Host "  Source : $Src"
Write-Host "  Target : $Dst"

Write-Step "Checking prerequisites"
$nodeVer = node --version 2>$null
if ($nodeVer) { Write-Ok "Node.js $nodeVer" }
else          { Write-Fail "Node.js not found - install from https://nodejs.org" }

$dotnet = dotnet --version 2>$null
if ($dotnet) { Write-Ok ".NET $dotnet" }
else         { Write-Warn ".NET not found - CLI features may not work" }

if ($Errors -gt 0) { Write-Host "`nFix errors above before continuing." -ForegroundColor Red; exit 1 }

Write-Step "Creating directory structure"
foreach ($dir in @("mcp-server", "review-server", "CLI", "TrayApp", "VoiceServer", "DebugView")) {
    $p = Join-Path $Dst $dir
    if (-not (Test-Path $p)) { New-Item -ItemType Directory $p -Force | Out-Null; Write-Ok "Created: $dir" }
    else                     { Write-Ok "Exists:  $dir" }
}

Write-Step "Installing MCP server"
Copy-Safe (Join-Path $Src "mcp-server\index.js")          (Join-Path $Dst "mcp-server\index.js")
Copy-Safe (Join-Path $Src "mcp-server\qwen_config.json")  (Join-Path $Dst "mcp-server\qwen_config.json")
Copy-Safe (Join-Path $Src "mcp-server\package.json")      (Join-Path $Dst "mcp-server\package.json")
Copy-Safe (Join-Path $Src "mcp-server\package-lock.json") (Join-Path $Dst "mcp-server\package-lock.json")
Write-Host "   Running npm install for MCP server..." -ForegroundColor DarkGray
Push-Location (Join-Path $Dst "mcp-server")
npm install --silent 2>&1 | Out-Null
Pop-Location
Write-Ok "MCP server dependencies installed"

Write-Step "Installing Review Panel"
Copy-Safe (Join-Path $Src "review-server\server.js")    (Join-Path $Dst "review-server\server.js")
Copy-Safe (Join-Path $Src "review-server\package.json") (Join-Path $Dst "review-server\package.json")
Write-Host "   Running npm install for Review Panel..." -ForegroundColor DarkGray
Push-Location (Join-Path $Dst "review-server")
npm install --silent 2>&1 | Out-Null
Pop-Location
Write-Ok "Review Panel dependencies installed"

Write-Step "Installing CLI (claudedev.exe)"
# Prefer fresh build output; fall back to committed copy in mcp-server\
$cliBuildSrc  = Join-Path $Src "bin\Release\net8.0\claudedev.exe"
$cliCommitted = Join-Path $Src "mcp-server\claudedev.exe"
$cliSrc = if (Test-Path $cliBuildSrc) { $cliBuildSrc } elseif (Test-Path $cliCommitted) { $cliCommitted } else { $null }
if ($cliSrc) {
    Copy-Safe $cliSrc (Join-Path $Dst "CLI\claudedev.exe")
    Copy-Safe $cliSrc (Join-Path $Dst "mcp-server\claudedev.exe")
} else {
    Write-Warn "claudedev.exe not found. Build first with:"
    Write-Warn "  dotnet build `"$Src`" -c Release"
}

Write-Step "Installing TrayApp"
$trayBuild = Join-Path $Src "ClaudeDevStudio.UI\bin\Release\net8.0-windows"
if (Test-Path $trayBuild) {
    $trayFiles = @("ClaudeDevStudio.TrayApp.exe","ClaudeDevStudio.TrayApp.dll",
                   "ClaudeDevStudio.TrayApp.deps.json","ClaudeDevStudio.TrayApp.runtimeconfig.json")
    foreach ($f in $trayFiles) { Copy-Safe (Join-Path $trayBuild $f) (Join-Path $Dst "TrayApp\$f") }
    # Register auto-start in registry
    $trayExe = Join-Path $Dst "TrayApp\ClaudeDevStudio.TrayApp.exe"
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" `
                     -Name "ClaudeDevStudio" -Value "`"$trayExe`"" -Force
    Write-Ok "Auto-start registered in registry"
    # Launch now
    Start-Process $trayExe -WindowStyle Hidden
    Write-Ok "TrayApp started"
} else {
    Write-Warn "TrayApp not built. Build first with:"
    Write-Warn "  dotnet build `"$Src\ClaudeDevStudio.UI`" -c Release"
}

Write-Step "Installing DebugView"
$dbgSrc = Join-Path $Src "Bundled"
if (Test-Path $dbgSrc) {
    foreach ($f in Get-ChildItem $dbgSrc -File) {
        Copy-Safe $f.FullName (Join-Path $Dst "DebugView\$($f.Name)")
    }
} else {
    Write-Warn "Bundled\ folder not found - DebugView not installed"
}

Write-Step "Installing VoiceServer binaries"
$vsBuild = Join-Path $Src "VoiceServer\bin\Release\net8.0\win-x64"
if (Test-Path $vsBuild) {
    foreach ($f in Get-ChildItem $vsBuild -File) {
        Copy-Safe $f.FullName (Join-Path $Dst "VoiceServer\$($f.Name)")
    }
    Write-Ok "VoiceServer binaries installed"
    # Check for large assets that must be placed manually
    $kokoroInDst = Join-Path $Dst "VoiceServer\kokoro.onnx"
    if (-not (Test-Path $kokoroInDst)) {
        Write-Warn "kokoro.onnx not found in VoiceServer\"
        Write-Warn "Copy kokoro.onnx (325MB) to: $Dst\VoiceServer\"
        Write-Warn "Also copy runtimes\ folder if TTS fails to initialise."
    } else {
        Write-Ok "kokoro.onnx present"
    }
} else {
    Write-Warn "VoiceServer not built. Build first with:"
    Write-Warn "  dotnet build `"$Src\VoiceServer`" -c Release -r win-x64"
}

Write-Step "Adding claudedev to user PATH"
$cliDir = Join-Path $Dst "CLI"
$currentPath = [Environment]::GetEnvironmentVariable("PATH", "User")
if ($currentPath -notlike "*ClaudeDevStudio\CLI*") {
    [Environment]::SetEnvironmentVariable("PATH", "$currentPath;$cliDir", "User")
    Write-Ok "Added to PATH: $cliDir"
    Write-Ok "Open a new terminal to use 'claudedev' from anywhere"
} else {
    Write-Skip "Already in PATH"
}

Write-Step "Configuring Claude Desktop"
$mcpPath   = Join-Path $Dst "mcp-server\index.js"
$configDir = Split-Path $ConfigFile -Parent
if (-not (Test-Path $configDir)) {
    Write-Warn "Claude Desktop not found at $configDir"
    Write-Warn "Install Claude Desktop from https://claude.ai/download, then re-run."
} else {
    $cfg = $null
    if (Test-Path $ConfigFile) {
        try { $cfg = Get-Content $ConfigFile -Raw | ConvertFrom-Json } catch {}
    }
    if (-not $cfg) { $cfg = [PSCustomObject]@{ mcpServers = [PSCustomObject]@{} } }
    if (-not $cfg.mcpServers) {
        $cfg | Add-Member -NotePropertyName mcpServers -NotePropertyValue ([PSCustomObject]@{})
    }
    $entry = [PSCustomObject]@{ command = "node"; args = @($mcpPath) }
    $cfg.mcpServers | Add-Member -NotePropertyName claudedevstudio -NotePropertyValue $entry -Force
    $cfg | ConvertTo-Json -Depth 10 | Set-Content $ConfigFile -Encoding UTF8
    Write-Ok "claude_desktop_config.json configured"
    Write-Ok "MCP server path: $mcpPath"
}

Write-Host "`n-----------------------------------------" -ForegroundColor DarkGray
if ($Errors -eq 0) {
    Write-Host "Install complete!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps:" -ForegroundColor Cyan
    Write-Host "  1. Restart Claude Desktop to activate the MCP server"
    Write-Host "  2. TrayApp is running - check system tray"
    Write-Host "  3. Review Panel: http://localhost:63000"
    Write-Host "  4. In a new conversation, type: load CDS"
    Write-Host ""
    Write-Host "After future dev changes, run: .\deploy.ps1" -ForegroundColor DarkGray
} else {
    Write-Host "Install finished with $Errors error(s). Review output above." -ForegroundColor Yellow
    Write-Host "Fix the errors, then re-run install.ps1 (it is safe to run repeatedly)." -ForegroundColor DarkGray
}
