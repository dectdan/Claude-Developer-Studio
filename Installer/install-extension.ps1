# Configure Claude Desktop for ClaudeDevStudio — direct MCP server entries
param(
  [string]$Version          = "1.2.0",
  [string]$UserAppData      = $env:APPDATA,
  [string]$UserLocalAppData = $env:LOCALAPPDATA
)

# NOTE: When called from an elevated (admin) NSIS installer, $env:APPDATA resolves
# to the admin profile, NOT the current user. NSIS passes $APPDATA and $LOCALAPPDATA
# explicitly so this script always writes to the correct user profile.

$LocalData   = $UserLocalAppData
$McpDir      = Join-Path $LocalData "ClaudeDevStudio\mcp-server"
$IndexJs     = Join-Path $McpDir "index.js"
$WorkbenchJs = Join-Path $McpDir "workbench.js"
$ConfigDir   = Join-Path $UserAppData "Claude"
$ConfigPath  = Join-Path $ConfigDir "claude_desktop_config.json"

Write-Host "ClaudeDevStudio v$Version — Configuring Claude Desktop..."

# Step 1: Ensure config directory exists
New-Item -ItemType Directory -Force -Path $ConfigDir | Out-Null

# Step 2: Find node.exe — full path so Claude Desktop sandbox can resolve it
$nodePath = "node"
$candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
)
foreach ($c in $candidates) {
    if (Test-Path $c) { $nodePath = $c; break }
}
if ($nodePath -eq "node") {
    $found = Get-Command node -ErrorAction SilentlyContinue
    if ($found) { $nodePath = $found.Source }
}

# Step 3: Read existing config to preserve preferences
$existingPrefs = ""
if (Test-Path $ConfigPath) {
    try {
        $existing = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        if ($existing.preferences) {
            $prefsJson = ($existing.preferences | ConvertTo-Json -Depth 10 -Compress)
            $existingPrefs = ',"preferences":' + $prefsJson
        }
    } catch {
        Write-Host "  (Could not read existing config, will create fresh)"
    }
}

# Step 4: Build config JSON with both MCP servers — manual string to avoid BOM/encoding issues
$escapedNode      = $nodePath.Replace('\', '\\')
$escapedIndex     = $IndexJs.Replace('\', '\\')
$escapedWorkbench = $WorkbenchJs.Replace('\', '\\')

$json = '{"mcpServers":{' +
    '"claudedevstudio":{"command":"' + $escapedNode + '","args":["' + $escapedIndex + '"]},' +
    '"cds-workbench":{"command":"' + $escapedNode + '","args":["' + $escapedWorkbench + '"]}' +
    '}' + $existingPrefs + '}'

# Step 5: Write clean UTF-8 without BOM
[System.IO.File]::WriteAllText($ConfigPath, $json, [System.Text.UTF8Encoding]::new($false))

Write-Host "  Node:      $nodePath"
Write-Host "  Core:      $IndexJs"
Write-Host "  Workbench: $WorkbenchJs"
Write-Host "  Config:    $ConfigPath"

# Step 6: Clean up any legacy extension registration
try {
    $ExtId = "ant.dir.gh.dectdan.claudedevstudio"
    $ExtDir = Join-Path $UserAppData "Claude\Claude Extensions\$ExtId"
    $InstallsJson = Join-Path $UserAppData "Claude\extensions-installations.json"
    $SettingsDir = Join-Path $UserAppData "Claude\Claude Extensions Settings"

    if (Test-Path $ExtDir) {
        Remove-Item $ExtDir -Recurse -Force
        Write-Host "  Removed legacy extension directory."
    }
    if (Test-Path $InstallsJson) {
        $installs = Get-Content $InstallsJson -Raw | ConvertFrom-Json
        if ($installs.extensions.PSObject.Properties.Name -contains $ExtId) {
            $installs.extensions.PSObject.Properties.Remove($ExtId)
            $installs | ConvertTo-Json -Depth 20 -Compress | Set-Content $InstallsJson -Encoding UTF8
            Write-Host "  Removed legacy extension registration."
        }
    }
    $extSettings = Join-Path $SettingsDir "$ExtId.json"
    if (Test-Path $extSettings) { Remove-Item $extSettings -Force }
} catch {
    Write-Host "  (Legacy cleanup skipped: $_)"
}

Write-Host "ClaudeDevStudio: Configuration complete. Restart Claude Desktop to activate."
exit 0
