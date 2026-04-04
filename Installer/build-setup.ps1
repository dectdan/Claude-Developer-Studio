# build-setup.ps1 — Build ClaudeDevStudio-Setup.exe
# Run from Administrator PowerShell: .\build-setup.ps1
# Requires: NSIS (choco install nsis -y as admin)

$ErrorActionPreference = "Stop"
$Root      = "D:\Projects\ClaudeDevStudio"
$Installer = "$Root\Installer"
$Build     = "$Installer\build"
$Output    = "$Installer\Output"

Write-Host "===== ClaudeDevStudio NSIS Installer Build =====" -ForegroundColor Cyan

# ---- 0. Verify NSIS ----
$makensis = "C:\Program Files (x86)\NSIS\makensis.exe"
if (!(Test-Path $makensis)) {
    Write-Host "ERROR: NSIS not found. Run as admin: choco install nsis -y" -ForegroundColor Red
    exit 1
}
Write-Host "  NSIS: OK" -ForegroundColor Green

# ---- Find MSBuild (needed for VSIX) ----
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$msbuild = $null
if (Test-Path $vswhere) {
    $vsPath = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath
    if ($vsPath) { $msbuild = "$vsPath\MSBuild\Current\Bin\MSBuild.exe" }
}
if ($msbuild -and (Test-Path $msbuild)) {
    Write-Host "  MSBuild: $msbuild" -ForegroundColor Green
} else {
    Write-Host "  MSBuild: not found -- VSIX will be skipped" -ForegroundColor Yellow
    $msbuild = $null
}

# ---- Clean build folder ----
if (Test-Path $Build) { Remove-Item $Build -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Build | Out-Null
New-Item -ItemType Directory -Force -Path $Output | Out-Null

# ---- 1. VoiceServer ----
Write-Host "`n[1/6] Building VoiceServer..." -ForegroundColor Yellow
dotnet publish "$Root\VoiceServer\VoiceServer.csproj" -c Release -r win-x64 --self-contained false -o "$Build\VoiceServer"
if ($LASTEXITCODE -ne 0) { Write-Host "  ERROR: VoiceServer build failed" -ForegroundColor Red; exit 1 }
Write-Host "  VoiceServer: OK" -ForegroundColor Green

# ---- 2. CLI tool ----
Write-Host "`n[2/6] Building CLI tool..." -ForegroundColor Yellow
dotnet publish "$Root\ClaudeDevStudio.csproj" -c Release -r win-x64 --self-contained false -o "$Build\CLI"
if ($LASTEXITCODE -ne 0) { Write-Host "  WARNING: CLI build failed -- skipping" -ForegroundColor Yellow }
else { Write-Host "  CLI: OK" -ForegroundColor Green }

# ---- 3. TrayApp ----
Write-Host "`n[3/6] Building TrayApp..." -ForegroundColor Yellow
dotnet publish "$Root\ClaudeDevStudio.UI\ClaudeDevStudio.TrayApp.csproj" -c Release -r win-x64 --self-contained false -o "$Build\TrayApp"
if ($LASTEXITCODE -ne 0) { Write-Host "  WARNING: TrayApp build failed -- skipping" -ForegroundColor Yellow }
else { Write-Host "  TrayApp: OK" -ForegroundColor Green }

# ---- 4. Dashboard (WinUI 3) ----
Write-Host "`n[4/7] Building Dashboard..." -ForegroundColor Yellow
dotnet publish "$Root\ClaudeDevStudio.Dashboard\ClaudeDevStudio.Dashboard.csproj" -c Release -r win-x64 --self-contained false -o "$Build\Dashboard"
if ($LASTEXITCODE -ne 0) { Write-Host "  WARNING: Dashboard build failed -- skipping" -ForegroundColor Yellow }
else { Write-Host "  Dashboard: OK" -ForegroundColor Green }

# ---- 5. VSIX (VS Bridge extension) ----
Write-Host "`n[5/7] Building VS Bridge VSIX..." -ForegroundColor Yellow
if ($msbuild) {
    # VSIX requires the full VS IDE MSBuild (not BuildTools) for VSSDK targets
    $vsMsbuildPaths = @(
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\MSBuild.exe",
        "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe"
    )
    $buildMsbuild = $vsMsbuildPaths | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (!$buildMsbuild) { $buildMsbuild = $msbuild }
    Write-Host "  Using MSBuild: $buildMsbuild"
    & $buildMsbuild "$Root\VSExtension\CdsVsBridge\CdsVsBridge.csproj" /p:Configuration=Release /t:Restore,Build /v:minimal
    $vsix = Get-ChildItem "$Root\VSExtension\CdsVsBridge\bin\Release\*.vsix" -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($vsix) {
        New-Item -ItemType Directory -Force -Path "$Build\VSExtension" | Out-Null
        Copy-Item $vsix.FullName "$Build\VSExtension\CdsVsBridge.vsix" -Force
        Write-Host "  VSIX: $($vsix.Name)" -ForegroundColor Green
    } else {
        Write-Host "  WARNING: VSIX not found after build -- skipping" -ForegroundColor Yellow
    }
} else {
    Write-Host "  Skipped (MSBuild not found)" -ForegroundColor Yellow
}

# ---- 5. Stage MCP server (with node_modules bundled) ----
Write-Host "`n[6/7] Staging MCP server + dependencies..." -ForegroundColor Yellow
$mcpDest = "$Build\mcp-server"
New-Item -ItemType Directory -Force -Path $mcpDest | Out-Null
Copy-Item "$Root\mcp-server\index.js"      $mcpDest -Force
Copy-Item "$Root\mcp-server\package.json"  $mcpDest -Force
# Bundle node_modules so npm install isn't needed on target machine
if (Test-Path "$Root\mcp-server\node_modules") {
    Write-Host "  Copying node_modules (~5 MB)..."
    Copy-Item "$Root\mcp-server\node_modules" "$mcpDest\node_modules" -Recurse -Force
}
Copy-Item "$Installer\ConfigureClaudeDesktop.ps1" "$Build\" -Force
Write-Host "  MCP server: OK" -ForegroundColor Green

# ---- 6. Kokoro voice model ----
Write-Host "`n[7/7] Staging Kokoro voice model..." -ForegroundColor Yellow
$kokoroSrc = "C:\Users\Big_D\AppData\Local\ClaudeDevStudio\VoiceServer\kokoro.onnx"
if (Test-Path $kokoroSrc) {
    $size = [int]((Get-Item $kokoroSrc).Length / 1MB)
    Write-Host "  Found kokoro.onnx ($size MB) -- bundling..."
    Copy-Item $kokoroSrc "$Build\VoiceServer\kokoro.onnx" -Force
    Write-Host "  Kokoro model: OK" -ForegroundColor Green
} else {
    Write-Host "  WARNING: kokoro.onnx not found -- installer will download it" -ForegroundColor Yellow
}

# ---- NSIS compile ----
Write-Host "`nCompiling installer..." -ForegroundColor Yellow
$nsisArgs = @("/V3")
if (Test-Path "$Installer\Assets\AppIcon.ico") { $nsisArgs += "/DHAVE_ICON" }
$nsisArgs += "setup.nsi"
Push-Location $Installer
& $makensis @nsisArgs
$nsisExit = $LASTEXITCODE
Pop-Location
if ($nsisExit -ne 0) { Write-Host "NSIS FAILED (exit $nsisExit)" -ForegroundColor Red; exit 1 }

# ---- Report ----
$exe = "$Output\ClaudeDevStudio-Setup.exe"
if (Test-Path $exe) {
    $mb = [int]((Get-Item $exe).Length / 1MB)
    Write-Host "`n===== BUILD COMPLETE =====" -ForegroundColor Cyan
    Write-Host "  Output : $exe" -ForegroundColor Green
    Write-Host "  Size   : $mb MB" -ForegroundColor Green
} else {
    Write-Host "ERROR: EXE not found after build!" -ForegroundColor Red; exit 1
}
