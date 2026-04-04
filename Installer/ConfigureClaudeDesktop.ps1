# Auto-configure Claude Desktop for ClaudeDevStudio
# This runs during MSI installation

param(
    [string]$MCPServerPath
)

$ErrorActionPreference = "Stop"

try {
    $configPath = "$env:APPDATA\Claude\claude_desktop_config.json"
    $configDir = Split-Path $configPath -Parent
    
    # Create Claude config directory if it doesn't exist
    if (!(Test-Path $configDir)) {
        New-Item -ItemType Directory -Path $configDir -Force | Out-Null
    }
    
    # Read existing config or start fresh
    $config = $null
    if (Test-Path $configPath) {
        try { $config = Get-Content $configPath -Raw -Encoding UTF8 | ConvertFrom-Json } catch {}
    }
    if (-not $config) { $config = [PSCustomObject]@{} }

    # Ensure mcpServers exists
    if (-not (Get-Member -InputObject $config -Name "mcpServers" -MemberType NoteProperty)) {
        $config | Add-Member -NotePropertyName "mcpServers" -NotePropertyValue ([PSCustomObject]@{})
    }

    # Add/update our entry only - preserves all other MCP servers
    $entry = [PSCustomObject]@{ command = "node"; args = @($MCPServerPath) }
    $config.mcpServers | Add-Member -NotePropertyName "claudedevstudio" -NotePropertyValue $entry -Force

    # Write back
    $config | ConvertTo-Json -Depth 10 | Set-Content $configPath -Encoding UTF8
    
    Write-Host "✓ Claude Desktop configured successfully"
    Write-Host "  Config: $configPath"
    Write-Host "  MCP Server: $MCPServerPath"
    
    exit 0
} catch {
    Write-Host "Error configuring Claude Desktop: $_"
    # Don't fail installation if config fails
    exit 0
}
