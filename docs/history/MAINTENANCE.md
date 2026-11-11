# ClaudeDevStudio — Maintenance Guide

**Last Updated:** 2026-03-11
**Maintainer:** Dan Gain (danielegain@gmail.com)
**Repo:** https://github.com/dectdan/Claude-Developer-Studio

---

## Architecture Overview

CDS has four components that work together:

| Component | Location | Purpose |
|---|---|---|
| CLI (`claudedev.exe`) | `C:\Users\Big_D\AppData\Local\ClaudeDevStudio\CLI\` | Core data read/write engine |
| MCP Server (`index.js`) | `C:\Users\Big_D\AppData\Local\ClaudeDevStudio\mcp-server\` | Bridge between Claude and the CLI |
| Tray App | `C:\Users\Big_D\AppData\Local\ClaudeDevStudio\TrayApp\` | Windows system tray UI |
| Dashboard | `C:\Users\Big_D\AppData\Local\ClaudeDevStudio\Dashboard\` | WinUI 3 dashboard app |

**Source repo:** `D:\Projects\ClaudeDevStudio\`
**Data storage:** `C:\Users\Big_D\OneDrive\Documents\ClaudeDevStudio\Projects\`
**Claude Desktop config:** `C:\Users\Big_D\AppData\Roaming\Claude\claude_desktop_config.json`

---

## Critical Known Issue (Fixed 2026-03-11)

The MCP server (`index.js`) had two bugs from launch:

1. **`load` returned nothing** — it called `claudedev.exe load <path>` which outputs only a session
   header. Fixed by reading the CDS data files directly instead.

2. **`record` commands silently failed** — the CLI `record` command does NOT take a project_path
   argument. The old code passed it as the record type, corrupting every write. Fixed by switching
   project first, then calling `record activity/mistake '...'`. Also added direct file write fallback.

**Fix is in:** `mcp-server/index.js` (both install dir and source repo)
**Backup of old broken file:** `mcp-server/index.js.bak_bugfix_20260311`

---

## Data File Structure

Each project stored at: `C:\Users\Big_D\OneDrive\Documents\ClaudeDevStudio\Projects\<ProjectName>\`

```
<ProjectName>/
├── CURRENT_SESSION_STATE.md   ← PRIMARY context file — keep this current!
├── FACTS.md                   ← Verified project facts
├── UNCERTAINTIES.md           ← Open questions / things to verify
├── session_state.json         ← CLI session metadata (auto-managed)
├── Activity/                  ← Activity log entries (JSON files, timestamped)
│   └── YYYY-MM-DDTHH-MM-SS_activity.json
│   └── YYYY-MM-DDTHH-MM-SS_mistake.json
├── Code_Snapshots/            ← Code snapshots (managed by CLI)
└── Archive/                   ← Archived data
```

---

## Routine Maintenance Tasks

### After every significant dev session
- [ ] Update `CURRENT_SESSION_STATE.md` with what changed, what's next
- [ ] Verify activities were recorded (`claudedev stats C:\Projects\<project>`)
- [ ] Run `git commit` + `git push` in `D:\Projects\ClaudeDevStudio` if index.js was changed

### When starting a new session
- [ ] Call `claudedev_load` with project path — verify it returns real content, not empty
- [ ] If load returns empty: check that `CURRENT_SESSION_STATE.md` exists and has content

### Monthly
- [ ] Review and prune stale Activity JSON files (keep last 90 days)
- [ ] Update FACTS.md with anything newly confirmed
- [ ] Clear UNCERTAINTIES.md of resolved questions

---

## How to Update the MCP Server

The MCP server is the JS layer Claude talks to. If you change `index.js`:

1. Edit source: `D:\Projects\ClaudeDevStudio\mcp-server\index.js`
2. **Backup install copy first:**
   ```powershell
   Copy-Item "C:\Users\Big_D\AppData\Local\ClaudeDevStudio\mcp-server\index.js" `
             "C:\Users\Big_D\AppData\Local\ClaudeDevStudio\mcp-server\index.js.bak_YYYYMMDD"
   ```
3. Copy to install dir:
   ```powershell
   Copy-Item "D:\Projects\ClaudeDevStudio\mcp-server\index.js" `
             "C:\Users\Big_D\AppData\Local\ClaudeDevStudio\mcp-server\index.js" -Force
   ```
4. Commit and push source:
   ```powershell
   Set-Location "D:\Projects\ClaudeDevStudio"
   git add mcp-server/index.js
   git commit -m "Description of change"
   git push
   ```
5. **Restart Claude Desktop** — the MCP server process must reload to pick up changes

---

## How to Rebuild the CLI (claudedev.exe)

Source is the C# project inside `D:\Projects\ClaudeDevStudio\`. Build with:
```powershell
Set-Location "D:\Projects\ClaudeDevStudio\CLI"
dotnet publish -c Release -r win-x64 --self-contained true
```
Then copy output to install dir and restart Claude Desktop.

---

## Troubleshooting

### `claudedev_load` returns empty
- Check `CURRENT_SESSION_STATE.md` exists and has content
- Run: `& "C:\Users\Big_D\AppData\Local\ClaudeDevStudio\CLI\claudedev.exe" projects`
  to verify SmartScribe is a known project
- If missing: run `claudedev_init` with the source project path

### Activities not being recorded
- Check the Activity folder for new JSON files after a record call
- Run `claudedev_stats` and look at "Direct file counts" line
- If CLI record fails, the fallback direct write should still work

### MCP server not responding
- Restart Claude Desktop
- Check `claude_desktop_config.json` still points to correct index.js path
- Test CLI directly:
  ```powershell
  & "C:\Users\Big_D\AppData\Local\ClaudeDevStudio\CLI\claudedev.exe" projects
  ```

### After a CDS update/reinstall overwrites index.js
- The source fix is in GitHub — pull and redeploy:
  ```powershell
  Set-Location "D:\Projects\ClaudeDevStudio"
  git pull
  Copy-Item ".\mcp-server\index.js" `
            "C:\Users\Big_D\AppData\Local\ClaudeDevStudio\mcp-server\index.js" -Force
  ```
- Restart Claude Desktop

---

## Planned Development (Roadmap)

### Near-term
- [ ] Visual Studio integration — see ROADMAP_VS_INTEGRATION.md
- [ ] `claudedev_update_state` tool — let Claude write directly to CURRENT_SESSION_STATE.md
- [ ] `claudedev_handoff` — generate end-of-session summary doc automatically

### Longer term
- [ ] Per-project FACTS.md auto-population from activity log
- [ ] Git integration for SmartScribe project tracking
- [ ] Multi-project dashboard improvements

---

## Key Paths Quick Reference

```
Source repo:         D:\Projects\ClaudeDevStudio\
Install dir:         C:\Users\Big_D\AppData\Local\ClaudeDevStudio\
MCP server source:   D:\Projects\ClaudeDevStudio\mcp-server\index.js
MCP server install:  C:\Users\Big_D\AppData\Local\ClaudeDevStudio\mcp-server\index.js
Claude config:       C:\Users\Big_D\AppData\Roaming\Claude\claude_desktop_config.json
CDS data root:       C:\Users\Big_D\OneDrive\Documents\ClaudeDevStudio\Projects\
SmartScribe data:    C:\Users\Big_D\OneDrive\Documents\ClaudeDevStudio\Projects\SmartScribe\
GitHub:              https://github.com/dectdan/Claude-Developer-Studio
```
