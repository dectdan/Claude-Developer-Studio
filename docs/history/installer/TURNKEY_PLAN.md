# ClaudeDevStudio - Turnkey Installation Plan

## Problem
Current installation requires users to:
1. Download/install DebugView separately
2. Install Node.js
3. Manually edit Claude Desktop config
4. Understand MCP, paths, JSON

**This is impossible for normal users.**

## Solution: One-Click Install

### What the MSI Must Do:
1. ✅ Install CLI tool (claudedev.exe)
2. ✅ Install TrayApp
3. ✅ Install Dashboard  
4. **NEW:** Bundle DebugView (no external download needed)
5. **NEW:** Auto-configure Claude Desktop config
6. **NEW:** Bundle MCP server
7. **NEW:** Check for Node.js, prompt if missing

### File Structure After Install:
```
%LOCALAPPDATA%\ClaudeDevStudio\
├── CLI\
│   └── claudedev.exe
├── TrayApp\
│   └── ClaudeDevStudio.TrayApp.exe
├── Dashboard\
│   └── ClaudeDevStudio.Dashboard.exe
├── DebugView\          ← NEW: Bundled
│   ├── dbgview64.exe
│   ├── Dbgview.exe
│   └── Eula.txt
└── mcp-server\         ← NEW: Bundled
    ├── index.js
    ├── package.json
    └── node_modules\

%APPDATA%\Claude\
└── claude_desktop_config.json  ← AUTO-CONFIGURED

%USERPROFILE%\Documents\ClaudeDevStudio\
├── Projects\           ← Memory storage
└── Backups\           ← Auto backups
```

### Installation Steps (All Automatic):

**Step 1: User Runs MSI**
- Shows standard install wizard
- License agreement
- Install location (default: %LOCALAPPDATA%\ClaudeDevStudio)

**Step 2: MSI Installs Files**
- Copies all components
- Includes DebugView
- Includes MCP server files

**Step 3: Post-Install Custom Actions**
1. Check if Node.js exists
   - If NO: Show message "MCP integration requires Node.js. Download from nodejs.org"
   - If YES: Run `npm install` in mcp-server directory

2. Configure Claude Desktop
   - Read existing `%APPDATA%\Claude\claude_desktop_config.json`
   - If doesn't exist, create it
   - Add/update mcpServers.claudedevstudio section
   - Keep other settings intact

3. Create Documents folders
   - `%USERPROFILE%\Documents\ClaudeDevStudio\Projects`
   - `%USERPROFILE%\Documents\ClaudeDevStudio\Backups`

**Step 4: Complete**
- Show success message
- Tell user to restart Claude Desktop
- Launch Dashboard

### User Experience:
1. Download ClaudeDevStudio.msi
2. Double-click
3. Click Next, Next, Install
4. See message: "Restart Claude Desktop to activate"
5. Restart Claude Desktop
6. **IT JUST WORKS**

## Implementation Tasks:

1. ✅ Copy DebugView to Bundled\ folder  
2. ✅ Update VSDebugMonitor.cs to use installed location
3. ⏳ Update Installer.wxs to include DebugView
4. ⏳ Create PowerShell custom action for Claude Desktop config
5. ⏳ Add custom action to WiX installer
6. ⏳ Bundle MCP server files in installer
7. ⏳ Add Node.js detection
8. ⏳ Test complete installation flow

## Files to Create/Modify:
- [ ] Installer.wxs - Add DebugView directory
- [ ] ConfigureClaudeDesktop.ps1 - Auto-config script
- [ ] CheckNodeJS.ps1 - Node.js detection script  
- [ ] Heat.exe commands - Include MCP server
- [ ] Build script - Automate everything

This makes ClaudeDevStudio a TRUE turnkey solution.
