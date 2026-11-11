# Checks that every place that carries the ClaudeDevStudio version agrees with
# Directory.Build.props (the one version). Prints each one; exits 1 if any differs.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\check-versions.ps1
#
# Works in Windows PowerShell 5.1 and PowerShell 7. Reads files only.

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

$rows = New-Object System.Collections.Generic.List[object]

function Add-Row([string]$Where, [string]$Found, [string]$Note = '') {
    $rows.Add([pscustomobject]@{ Where = $Where; Version = $Found; Note = $Note })
}

function Read-Text([string]$RelPath) {
    $full = Join-Path $Root $RelPath
    if (-not (Test-Path -LiteralPath $full)) { return $null }
    return [System.IO.File]::ReadAllText($full)
}

function Find-Version([string]$RelPath, [string]$Pattern, [string]$Note = '') {
    $text = Read-Text $RelPath
    if ($null -eq $text) { Add-Row $RelPath 'MISSING FILE' $Note; return }
    $m = [regex]::Match($text, $Pattern)
    if ($m.Success) { Add-Row $RelPath $m.Groups[1].Value $Note }
    else { Add-Row $RelPath 'NOT FOUND' $Note }
}

# 1. The one version.
$props = Read-Text 'Directory.Build.props'
$expected = $null
if ($props) {
    $m = [regex]::Match($props, '<Version>\s*([^<\s]+)\s*</Version>')
    if ($m.Success) { $expected = $m.Groups[1].Value }
}
if (-not $expected) {
    Write-Host 'Directory.Build.props has no <Version>; nothing to compare against.' -ForegroundColor Red
    exit 1
}
Add-Row 'Directory.Build.props' $expected 'the one version'

# 2. C# projects must not set their own version (they inherit Directory.Build.props).
foreach ($proj in @('ClaudeDevStudio.csproj',
                    'ClaudeDevStudio.UI\ClaudeDevStudio.TrayApp.csproj',
                    'ClaudeDevStudio.Dashboard\ClaudeDevStudio.Dashboard.csproj',
                    'VSExtension\CdsVsBridge\CdsVsBridge.csproj')) {
    $text = Read-Text $proj
    if ($null -eq $text) { Add-Row $proj 'MISSING FILE'; continue }
    $m = [regex]::Match($text, '<(?:Version|VersionPrefix|AssemblyVersion|FileVersion)>\s*([^<\s]+)\s*</')
    if ($m.Success) { Add-Row $proj $m.Groups[1].Value 'sets its own version: remove it' }
    else { Add-Row $proj $expected 'inherits Directory.Build.props' }
}

# 3. Files that must carry the same number.
Find-Version 'mcp-server\package.json'   '"version"\s*:\s*"([^"]+)"'
Find-Version 'mcp-server\manifest.json'  '"version"\s*:\s*"([^"]+)"'
Find-Version 'review-server\package.json' '"version"\s*:\s*"([^"]+)"'
Find-Version 'Installer\setup.nsi'       '!define\s+PRODUCT_VERSION\s+"([^"]+)"'
Find-Version 'Installer\install-extension.ps1' '\[string\]\$Version\s*=\s*"([^"]+)"'
Find-Version 'VSExtension\CdsVsBridge\source.extension.vsixmanifest' '<Identity\b[^>]*\bVersion="([^"]+)"'
Find-Version 'VSExtension\CdsVsBridge\CdsVsBridgePackage.cs' 'extension_loaded",\s*new\s*\{\s*version\s*=\s*"([^"]+)"'

# 4. Code that must read the version, not hold a literal.
$pkg = Read-Text 'mcp-server\package.json'
$pkgVersion = 'NOT FOUND'
if ($pkg) {
    $m = [regex]::Match($pkg, '"version"\s*:\s*"([^"]+)"')
    if ($m.Success) { $pkgVersion = $m.Groups[1].Value }
}
foreach ($server in @('mcp-server\index.js', 'mcp-server\workbench.js')) {
    $text = Read-Text $server
    if ($null -eq $text) { Add-Row $server 'MISSING FILE'; continue }
    $literal = [regex]::Match($text, "new Server\(\s*\{[^}]*version\s*:\s*['""]([^'""]+)['""]")
    if ($literal.Success) { Add-Row $server $literal.Groups[1].Value 'literal in new Server(...): read package.json instead' }
    elseif ($text -match 'package\.json' -and $text -match 'version\s*:\s*VERSION') { Add-Row $server $pkgVersion 'reads mcp-server\package.json' }
    else { Add-Row $server 'UNKNOWN' 'could not tell where the version comes from' }
}

$program = Read-Text 'Program.cs'
if ($null -eq $program) { Add-Row 'Program.cs' 'MISSING FILE' }
else {
    $literal = [regex]::Match($program, 'ClaudeDevStudio v(\d+\.\d+\.\d+)')
    if ($literal.Success) { Add-Row 'Program.cs' $literal.Groups[1].Value 'literal in help/version text' }
    else { Add-Row 'Program.cs' $expected 'prints the assembly version' }
}

# 5. The built CLI, if there is one (proves ShowVersion prints the assembly version).
$exe = Join-Path $Root 'bin\Release\net8.0\claudedev.exe'
if (Test-Path -LiteralPath $exe) {
    $out = (& $exe version 2>&1 | Out-String)
    $m = [regex]::Match($out, 'ClaudeDevStudio v(\S+)')
    if ($m.Success) { Add-Row 'bin\Release\net8.0\claudedev.exe version' $m.Groups[1].Value 'built CLI' }
    else { Add-Row 'bin\Release\net8.0\claudedev.exe version' 'NOT FOUND' 'built CLI' }
}

# Report.
$bad = 0
foreach ($r in $rows) {
    $ok = ($r.Version -eq $expected)
    if (-not $ok) { $bad++ }
    $mark = 'OK  '
    $color = 'Green'
    if (-not $ok) { $mark = 'DIFF'; $color = 'Red' }
    $line = '{0}  {1,-10} {2}' -f $mark, $r.Version, $r.Where
    if ($r.Note) { $line += "  ($($r.Note))" }
    Write-Host $line -ForegroundColor $color
}

Write-Host ''
if ($bad -eq 0) {
    Write-Host "All $($rows.Count) places say $expected." -ForegroundColor Green
    exit 0
}
Write-Host "$bad of $($rows.Count) places differ from $expected (Directory.Build.props)." -ForegroundColor Red
exit 1
