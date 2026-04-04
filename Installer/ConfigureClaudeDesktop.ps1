# Auto-configure Claude Desktop for ClaudeDevStudio
# This runs during installation and via 'claudedev configure-claude'

param(
    [string]$MCPServerPath
)

try {
    $configDir  = Join-Path $env:APPDATA "Claude"
    $configPath = Join-Path $configDir "claude_desktop_config.json"

    New-Item -ItemType Directory -Force -Path $configDir | Out-Null

    # Escape backslashes for JSON
    $escapedPath = $MCPServerPath.Replace('\', '\\')

    # Write clean JSON directly - no parsing, no serialization, no risk of corruption
    $json = '{"mcpServers":{"claudedevstudio":{"command":"node","args":["' + $escapedPath + '"]}}}'
    [System.IO.File]::WriteAllText($configPath, $json, [System.Text.UTF8Encoding]::new($false))

    Write-Host "Claude Desktop configured successfully"
    Write-Host "  Config: $configPath"
    Write-Host "  MCP Server: $MCPServerPath"
    exit 0
}
catch {
    Write-Host "Error configuring Claude Desktop: $_"
    exit 1
}

