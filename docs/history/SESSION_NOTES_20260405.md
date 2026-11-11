# Session Notes — April 5, 2026

## v1.2.0 Released

### Problem Solved
CDS MCP server had 21 tools with verbose descriptions in a single file (54KB).
Claude Desktop has a 1MB per-server tool definition limit. All CDS tools silently
failed to load — the server connected but tools never appeared.

### Solution: Split Architecture
- **index.js** (16KB) — claudedevstudio server, 9 core memory tools
- **workbench.js** (30KB) — cds-workbench server, 13 power tools
- All descriptions trimmed to one line each
- claude_desktop_config.json gets two server entries

### New Features
1. **list_models** tool — queries provider /v1/models endpoints for real-time catalog
2. **API key auto-verification** in TrayApp — green ✓ / red ✗ on form open and field blur
3. **Direct config approach** — dropped Claude Extensions system, simpler and proven

### Architecture Change
- Switched from Claude Extensions (install-extension.ps1 with manifest.json) to
  direct claude_desktop_config.json entries (two servers)
- Legacy extension cleanup runs automatically on install/uninstall

### Installer Updates
- build-setup.ps1 stages workbench.js
- install-extension.ps1 rewritten for direct config
- setup.nsi uninstaller removes both MCP entries + legacy extension
- ConfigureClaudeDesktop.ps1 updated for two servers

### Fixes
- Fireworks model ID: qwen3-235b-a22b (dead) → llama-v3p3-70b-instruct
- Fixed Fireworks description in TrayApp UI and template config

### Testing
- VM clean install: passed
- All 5 AI providers verified working
- Review Panel and image gen confirmed
- API key verification form working
