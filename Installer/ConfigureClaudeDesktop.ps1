# Auto-configure Claude Desktop for ClaudeDevStudio
param([string]$MCPServerPath)

try {
    $configDir  = Join-Path $env:APPDATA "Claude"
    $configPath = Join-Path $configDir "claude_desktop_config.json"
    New-Item -ItemType Directory -Force -Path $configDir | Out-Null

    # Find node.exe - use full path so Claude Desktop (Store app) can find it
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

    # Escape backslashes for JSON
    $escapedNode = $nodePath.Replace('\', '\\')
    $escapedMcp  = $MCPServerPath.Replace('\', '\\')

    # Write clean JSON - no BOM, no serialization
    $json = '{"mcpServers":{"claudedevstudio":{"command":"' + $escapedNode + '","args":["' + $escapedMcp + '"]}}}'
    [System.IO.File]::WriteAllText($configPath, $json, [System.Text.UTF8Encoding]::new($false))

    Write-Host "Claude Desktop configured successfully"
    Write-Host "  Node:   $nodePath"
    Write-Host "  Config: $configPath"
    exit 0
}
catch {
    Write-Host "Error: $_"
    exit 1
}
