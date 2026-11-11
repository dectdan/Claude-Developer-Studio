# ClaudeDevStudio v1.2.1 — Patch Release

## Bug Fix: VS Bridge Path Resolution on OneDrive Systems

### What was broken
On systems where Windows redirects the Documents folder to OneDrive (the default on most modern Windows 11 installations), the VS Bridge MCP server could not find its state files.

The VS extension (`CdsVsBridge`) correctly uses `Environment.GetFolderPath(SpecialFolder.MyDocuments)` which resolves to the right path — typically `C:\Users\{user}\OneDrive\Documents\ClaudeDevStudio\VSBridge\`. However, `workbench.js` was hardcoding `USERPROFILE\Documents\ClaudeDevStudio\VSBridge` without checking OneDrive.

**Symptoms:**
- `claudedev_vs_get_state` returned "vs_state.json not found"
- `claudedev_vs_get_errors` returned "vs_errors.json not found"
- `claudedev_vs_get_output` returned "vs_build_output.txt not found"
- VS Bridge command side (build, debug, step) still worked correctly
- No error messages — silent failure

### What was fixed
`workbench.js` now probes both possible Documents locations and uses whichever one actually exists:

```javascript
function resolveVsBridgeDir() {
  const base = process.env.USERPROFILE || process.env.HOME;
  const candidates = [
    path.join(base, 'OneDrive', 'Documents', 'ClaudeDevStudio', 'VSBridge'),
    path.join(base, 'Documents', 'ClaudeDevStudio', 'VSBridge'),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(dir)) return dir;
  }
  return candidates[1]; // fallback
}
```

This fix works for all configurations: standard Documents, OneDrive-redirected Documents, and custom redirections.

### Who is affected
Any user with OneDrive installed and Documents sync enabled (the default on Windows 11). The VS Bridge command side was always functional — only the state/error/output read-back was broken.

### Files changed
- `mcp-server/workbench.js` — path resolution fix
- `Installer/build/mcp-server/workbench.js` — staging copy updated

---

## What's included from v1.2.0
- Split MCP server architecture (claudedevstudio + cds-workbench)
- Dynamic model discovery via `list_models` tool
- API key auto-verification in TrayApp
- Direct claude_desktop_config.json integration (no extension system dependency)
- VS Bridge with full bidirectional Visual Studio control
