# CDS Session Notes — April 4, 2026

## STATUS: v1.1.0 RELEASED ✅

### What Was Accomplished This Session

**Goal:** Make CDS properly deployable from a clean installer. Tested on real VM.

---

## Installer — Now Production Ready

The installer at:
  D:\Projects\ClaudeDevStudio\Installer\Output\ClaudeDevStudio-Setup.exe
  Size: 511MB | Built: April 4 2026 6:56 PM

Is verified working via clean VM test (reverted to fresh snapshot, installed
Claude Desktop, ran installer, CDS connected automatically — no manual steps).

---

## All Bugs Fixed This Session

1. **BOM corruption** — UTF-8 BOM was written to claude_desktop_config.json.
   Claude Desktop JSON parser rejected it. Fixed: use UTF8Encoding(false).

2. **Node.js not installing** — installer ran as `user`, msiexec needs admin.
   Fixed: RequestExecutionLevel changed to `admin`. UAC prompt now appears (correct).

3. **`node` not found by Claude Desktop** — Store app sandbox can't resolve PATH.
   Fixed: ConfigureClaudeDesktop.ps1 now searches for full node.exe path and
   writes it explicitly (C:\Program Files\nodejs\node.exe).

4. **Wrong APPDATA when elevated** — Elevated PowerShell resolves $env:APPDATA
   to administrator profile, not user profile. Config was written to wrong place.
   Fixed: NSIS passes $APPDATA explicitly to the PS1 script.

5. **Old PS1 being packaged** — Feb 14 version of ConfigureClaudeDesktop.ps1
   was in the build folder. Fixes were in the source but never staged.
   Fixed: build-setup.ps1 always copies PS1 to build folder before NSIS runs.

6. **Hardcoded paths** — index.js had C:\Users\Big_D\OneDrive hardcoded everywhere.
   Would break on any other machine. Fixed: uses USERPROFILE env var dynamically.

7. **OneDrive assumption** — CDS assumed Documents is on OneDrive. Fixed: now uses
   Documents directly via path.join(USERPROFILE, 'Documents', ...).

8. **API keys in config** — Real API keys were in qwen_config.json (gitignored).
   Installer now ships qwen_config.template.json with all keys blank.

---

## New Features Added

- **TrayApp: "Link Claude Desktop..."** — re-runs configuration anytime
- **TrayApp: "Configure AI Keys..."** — form to enter provider API keys
- **claudedev configure-claude** — CLI command to link Claude Desktop
- **MCP server startup warning** — logs if no API keys configured
- **qwen_generate graceful error** — tells user where to add keys instead of crashing

---

## GitHub Status

- Branch: main, all changes committed and pushed
- Tag: v1.1.0 pushed
- Release: v1.1.0 published with ClaudeDevStudio-v1.1.0-Setup.exe (511MB)
- Last commit: f273c0e — Fix admin elevation breaking config + remove hardcoded paths

---

## API Keys

Real keys are in: C:\Users\Big_D\AppData\Local\ClaudeDevStudio\mcp-server\qwen_config.json
This file is gitignored and never in any build or release.
Users configure their own keys via TrayApp → Configure AI Keys...

Providers supported: Together AI, Groq, DeepInfra, Fireworks, OpenRouter
Purpose: Offload coding tasks to Qwen3-Coder-480B to extend Claude sessions.

---

## VM Snapshots

Machine: WINDEV2407EVAL (Windows 11 dev environment)
- "Clean - Fresh Install" — original VM state, nothing installed
- "CDS Working - Node.js full path" — after manual fix session
- Should add: "CDS v1.1.0 - Clean Install Verified" after final test

---

## Website

D:\websites\claudedevstudio.com\index.html updated to v1.1.0
Download link: https://github.com/dectdan/Claude-Developer-Studio/releases/download/v1.1.0/ClaudeDevStudio-v1.1.0-Setup.exe
Needs to be uploaded to hosting.

---

## Next Session

- Upload website to hosting
- Take "CDS v1.1.0 - Clean Install Verified" snapshot on VM
- Watch for any user issues on GitHub
- Session continuity: load this file, check git log, run claudedev stats
