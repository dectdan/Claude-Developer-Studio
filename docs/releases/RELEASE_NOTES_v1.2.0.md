# ClaudeDevStudio v1.2.0 Release Notes

## What's New

### Split MCP Architecture
The monolithic MCP server has been split into two lean servers to improve reliability:
- **claudedevstudio** — Core memory system (9 tools): init, load, record, check, stats, monitor, checkpoint, resume
- **cds-workbench** — Power tools (13 tools): VS Bridge, AI delegation, Review Panel, image generation, model discovery

This resolves a critical issue where Claude Desktop's tool definition size limit prevented all CDS tools from loading.

### Dynamic Model Discovery
New `list_models` tool lets Claude query any AI provider's model catalog in real-time — see available models, context lengths, and pricing before choosing what to use for a task.

### API Key Auto-Verification
The "Configure AI Keys" form now verifies keys automatically:
- Existing keys are verified when the form opens
- New keys verify instantly when you tab to the next field
- Green checkmark (✓ Valid) or red X (✗ Invalid) status shown in real-time
- Zero-cost verification using provider model listing endpoints

### Direct Config Integration
Switched from Claude Extensions system to direct `claude_desktop_config.json` entries — simpler, more reliable, and supports the two-server architecture. Legacy extension registrations are cleaned up automatically on install.

### Bug Fixes
- Fixed Fireworks AI model ID (previous default model was decommissioned)
- Updated Fireworks provider description in config and UI

## Installation
Download `ClaudeDevStudio-Setup.exe` and run. The installer will:
1. Install all components (CLI, TrayApp, Dashboard, MCP servers)
2. Install Node.js if not present (requires admin)
3. Configure Claude Desktop with both MCP servers
4. Set up auto-start TrayApp

After install, restart Claude Desktop to activate.

## Configure AI Providers
Right-click the ClaudeDevStudio tray icon → **Configure AI Keys** to add provider API keys.
Supported providers: Together AI, Groq, DeepInfra, Fireworks, OpenRouter.

## System Requirements
- Windows 10/11 (64-bit)
- .NET 8 Runtime (installed automatically if missing)
- Claude Desktop app

**Full Changelog**: https://github.com/dectdan/Claude-Developer-Studio/compare/v1.1.0...v1.2.0
