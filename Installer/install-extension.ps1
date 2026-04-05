param(
  [string]$Version        = "1.1.1",
  [string]$UserAppData    = $env:APPDATA,
  [string]$UserLocalAppData = $env:LOCALAPPDATA
)

# NOTE: When called from an elevated (admin) NSIS installer, $env:APPDATA resolves
# to the admin profile, NOT the current user. NSIS passes $APPDATA and $LOCALAPPDATA
# explicitly so this script always writes to the correct user profile.

$ExtId       = "ant.dir.gh.dectdan.claudedevstudio"
$ExtDir      = Join-Path $UserAppData "Claude\Claude Extensions\$ExtId"
$SettingsDir = Join-Path $UserAppData "Claude\Claude Extensions Settings"
$InstallsJson = Join-Path $UserAppData "Claude\extensions-installations.json"
$LocalData   = $UserLocalAppData
$McpSrc      = Join-Path $LocalData "ClaudeDevStudio\mcp-server"

Write-Host "ClaudeDevStudio: Registering Claude extension v$Version..."

# Step 1: Ensure directories exist
New-Item -ItemType Directory -Force -Path "$ExtDir\server" | Out-Null
New-Item -ItemType Directory -Force -Path $SettingsDir | Out-Null

# Step 2: Copy server files to extension directory
Copy-Item "$McpSrc\index.js"      "$ExtDir\server\index.js" -Force
Copy-Item "$McpSrc\package.json"  "$ExtDir\package.json"    -Force
Copy-Item "$McpSrc\manifest.json" "$ExtDir\manifest.json"   -Force

# Step 3: Copy node_modules (delete first to avoid stale files from old SDK)
if (Test-Path "$ExtDir\node_modules") {
    Remove-Item "$ExtDir\node_modules" -Recurse -Force
}
Copy-Item "$McpSrc\node_modules" "$ExtDir\node_modules" -Recurse -Force
Write-Host "ClaudeDevStudio: Extension files copied."

# Step 4: Register in extensions-installations.json
try {
    $Manifest = Get-Content "$ExtDir\manifest.json" -Raw | ConvertFrom-Json

    $NewEntry = [PSCustomObject]@{
        id            = $ExtId
        version       = $Version
        hash          = "0000000000000000000000000000000000000000000000000000000000000000"
        installedAt   = (Get-Date -Format "o")
        manifest      = $Manifest
        signatureInfo = [PSCustomObject]@{ status = "unsigned" }
        source        = "local"
    }

    if (Test-Path $InstallsJson) {
        $Installs = Get-Content $InstallsJson -Raw | ConvertFrom-Json
    } else {
        $Installs = [PSCustomObject]@{ extensions = [PSCustomObject]@{} }
    }

    $Installs.extensions | Add-Member -MemberType NoteProperty -Name $ExtId -Value $NewEntry -Force
    $Installs | ConvertTo-Json -Depth 20 -Compress | Set-Content $InstallsJson -Encoding UTF8
    Write-Host "ClaudeDevStudio: Registered in extensions-installations.json."
} catch {
    Write-Warning "ClaudeDevStudio: Failed to update extensions-installations.json: $_"
}

# Step 5: Enable the extension
try {
    $EnabledContent = '{"isEnabled":true}'
    Set-Content (Join-Path $SettingsDir "$ExtId.json") -Value $EnabledContent -Encoding UTF8
    Write-Host "ClaudeDevStudio: Extension enabled."
} catch {
    Write-Warning "ClaudeDevStudio: Failed to write extension settings: $_"
}

# Step 6: Remove legacy claudedevstudio entry from claude_desktop_config.json
try {
    $ConfigPath = Join-Path $UserAppData "Claude\claude_desktop_config.json"
    if (Test-Path $ConfigPath) {
        $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
        if ($Config.mcpServers -and
            $Config.mcpServers.PSObject.Properties.Name -contains "claudedevstudio") {
            $Config.mcpServers.PSObject.Properties.Remove("claudedevstudio")
            $Config | ConvertTo-Json -Depth 10 | Set-Content $ConfigPath -Encoding UTF8
            Write-Host "ClaudeDevStudio: Removed legacy claude_desktop_config.json entry."
        }
    }
} catch {
    Write-Warning "ClaudeDevStudio: Failed to clean claude_desktop_config.json: $_"
}

Write-Host "ClaudeDevStudio: Extension registration complete. Please restart Claude Desktop."
