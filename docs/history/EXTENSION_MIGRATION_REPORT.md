# ClaudeDevStudio — Claude Desktop Extension Migration
## Session Report: April 4, 2026
### Root Cause, Fix Applied, and Installer Build Plan

---

## 1. WHAT BROKE AND WHY

### The Breaking Change
Claude Desktop auto-updated to **v1.569.0.0** on **April 2, 2026**.

This update changed how local MCP servers are handled. Prior to v1.569, adding an entry
to `claude_desktop_config.json` was sufficient for Claude to use MCP tools. As of v1.569,
Claude Desktop moved to a new **Desktop Extension (DXT/MCPB)** system. Tools from
`claude_desktop_config.json` entries are still *launched*, but they are no longer
*exposed to the AI* unless the server is registered as a proper extension.

### Evidence in the Logs
```
# BEFORE FIX — server ran but tools were invisible:
[warn] UtilityProcess Check: Extension claudedevstudio not found in installed extensions

# AFTER FIX — server runs as proper extension:
[info] Using UtilityProcess for extension ClaudeDevStudio
[info] [UtilityProcess stderr] ClaudeDevStudio MCP server running on stdio
```

### Secondary Issue Discovered
The MCP SDK was version `0.5.0`, speaking protocol version `2024-11-05`.
Claude Desktop v1.569 speaks `2025-11-25`. This was a separate bug that
would have caused tool call failures even if the extension registration was fixed.

---

## 2. COMPLETE FIX APPLIED (Manual / Immediate)

### Fix 1: Update MCP SDK
**File:** `mcp-server/package.json`
```json
// Before
"@modelcontextprotocol/sdk": "^0.5.0"

// After
"@modelcontextprotocol/sdk": "^1.29.0"
```
Then ran `npm install` in both source and installed locations.

### Fix 2: Fix Relative Paths in index.js
The server previously used `__dirname` to find sibling files (CLI, qwen_config, review-server).
When the server moves to the extension directory, `__dirname` points to a completely
different location, breaking all these paths.

**Added constant at top of index.js:**
```javascript
const CDS_INSTALL_PATH = path.join(
  process.env.LOCALAPPDATA || path.join(process.env.USERPROFILE || 'C:\\Users\\Default', 'AppData', 'Local'),
  'ClaudeDevStudio'
);
```

**Changed paths (5 edits):**
```javascript
// CLAUDEDEV_PATH
// Before:
const CLAUDEDEV_PATH = path.join(__dirname, '..', 'CLI', 'claudedev.exe');
// After:
const CLAUDEDEV_PATH = path.join(CDS_INSTALL_PATH, 'CLI', 'claudedev.exe');

// qwen_config.json — checkApiKeys() function
// Before:
const cfgPath = path.join(__dirname, 'qwen_config.json');
// After:
const cfgPath = path.join(CDS_INSTALL_PATH, 'mcp-server', 'qwen_config.json');

// qwen_config.json — handleQwenGenerate() method
// Before:
const cfgPath = path.join(__dirname, 'qwen_config.json');
// After:
const cfgPath = path.join(CDS_INSTALL_PATH, 'mcp-server', 'qwen_config.json');

// qwen_config.json — handleGenerateImage() method
// Before:
const cfgPath = path.join(__dirname, 'qwen_config.json');
// After:
const cfgPath = path.join(CDS_INSTALL_PATH, 'mcp-server', 'qwen_config.json');

// review-server — startReviewPanel() method
// Before:
const serverPath = path.join(__dirname, '..', 'review-server', 'server.js');
// After:
const serverPath = path.join(CDS_INSTALL_PATH, 'review-server', 'server.js');
```

### Fix 3: Create Claude Extension Directory Structure
```
%APPDATA%\Claude\Claude Extensions\ant.dir.gh.dectdan.claudedevstudio\
├── manifest.json          ← Extension manifest (new file)
├── package.json           ← Copied from mcp-server/
├── server\
│   └── index.js           ← Copied from mcp-server/ (with path fixes)
└── node_modules\          ← Full dependency tree (SDK 1.29.0)
```

### Fix 4: Create manifest.json
Full extension manifest at the extension root:
```json
{
  "manifest_version": "0.2",
  "name": "claudedevstudio",
  "display_name": "ClaudeDevStudio",
  "version": "1.1.0",
  "description": "Persistent memory for Claude AI across development sessions.",
  "author": { "name": "Daniel E Gain", "url": "https://claudedevstudio.com" },
  "server": {
    "type": "node",
    "entry_point": "server/index.js",
    "mcp_config": {
      "command": "node",
      "args": ["${__dirname}/server/index.js"]
    }
  },
  "tools": [ ... 22 tools listed ... ],
  "license": "MIT"
}
```
**CRITICAL:** The `${__dirname}` in args is replaced at runtime by Claude Desktop
with the full path to the extension directory.

### Fix 5: Register in extensions-installations.json
Added entry to:
`%APPDATA%\Claude\extensions-installations.json`
```json
"ant.dir.gh.dectdan.claudedevstudio": {
  "id": "ant.dir.gh.dectdan.claudedevstudio",
  "version": "1.1.0",
  "hash": "0000...0000",
  "installedAt": "<timestamp>",
  "manifest": { ... full manifest object ... },
  "signatureInfo": { "status": "unsigned" },
  "source": "local"
}
```

### Fix 6: Create Extension Settings File (THE KEY MISSING PIECE)
Without this file, Claude Desktop recognizes the extension but never launches it.
```
%APPDATA%\Claude\Claude Extensions Settings\ant.dir.gh.dectdan.claudedevstudio.json
```
Contents:
```json
{
  "isEnabled": true
}
```

### Fix 7: Remove from claude_desktop_config.json
Emptied the `mcpServers` object — the extension system now handles launching,
so the config entry is no longer needed (and would cause a duplicate launch).

---

## 3. HOW THE NEW EXTENSION SYSTEM WORKS

### File Structure Required
```
%APPDATA%\Claude\
├── claude_desktop_config.json          ← Leave mcpServers empty for extensions
├── extensions-installations.json       ← Registry of installed extensions
├── Claude Extensions\
│   └── {extension-id}\                 ← Extension files live here
│       ├── manifest.json
│       ├── server\index.js
│       └── node_modules\
└── Claude Extensions Settings\
    └── {extension-id}.json             ← { "isEnabled": true }
```

### Extension ID Format
`ant.dir.gh.{github-username}.{repo-slug}`
- Anthropic extensions: `ant.dir.ant.anthropic.{name}`
- GitHub extensions:    `ant.dir.gh.{username}.{reponame}`
- ClaudeDevStudio ID:   `ant.dir.gh.dectdan.claudedevstudio`

### How Claude Desktop Launches Extensions
1. Reads `extensions-installations.json` to find all known extensions
2. Checks `Claude Extensions Settings\{id}.json` for `isEnabled: true`
3. Reads `manifest.json` from `Claude Extensions\{id}\`
4. Substitutes `${__dirname}` with the extension directory path
5. Launches as UtilityProcess (sandboxed Node.js) using built-in Node runtime
6. Tools from manifest are pre-declared for permissions UI
7. Tools from MCP protocol are exposed to the AI

### Why UtilityProcess Matters
- Regular process (old way): Claude Desktop could talk to it, but tools weren't exposed to AI
- UtilityProcess (new way): Properly sandboxed, tools are declared and available to AI

---

## 4. INSTALLER BUILD PLAN

### What the Installer Must Now Do

The WiX MSI installer needs to perform these steps, in order:

#### Step A: Install Core Files (unchanged)
- CLI to `%LOCALAPPDATA%\ClaudeDevStudio\CLI\`
- TrayApp to `%LOCALAPPDATA%\ClaudeDevStudio\`
- Review server to `%LOCALAPPDATA%\ClaudeDevStudio\review-server\`
- MCP server files to `%LOCALAPPDATA%\ClaudeDevStudio\mcp-server\`
  (includes updated index.js, package.json, node_modules with SDK 1.29.0)

#### Step B: Install Extension Files (NEW)
Copy to `%APPDATA%\Claude\Claude Extensions\ant.dir.gh.dectdan.claudedevstudio\`:
- `manifest.json` (static file, ship with installer)
- `server\index.js` (same as mcp-server\index.js)
- `package.json`
- `node_modules\` (full tree — SDK 1.29.0)

#### Step C: Register Extension (NEW — PowerShell Custom Action)
Run a PowerShell script that:
1. Reads `%APPDATA%\Claude\extensions-installations.json`
2. Adds/updates the `ant.dir.gh.dectdan.claudedevstudio` entry
3. Writes it back

#### Step D: Enable Extension (NEW)
Write `%APPDATA%\Claude\Claude Extensions Settings\ant.dir.gh.dectdan.claudedevstudio.json`:
```json
{ "isEnabled": true }
```

#### Step E: Clear Old Config Entry (NEW)
Read `%APPDATA%\Claude\claude_desktop_config.json` and remove the
`mcpServers.claudedevstudio` entry if present (upgrade cleanup).

#### Step F: Restart Claude Desktop (unchanged)
Kill and restart Claude.exe so it picks up the new extension.

### Implementation Approach for WiX

The JSON manipulation (steps C and E) cannot be done with WiX XML alone.
Use a **PowerShell Deferred Custom Action** in the installer.

**Option 1: Embedded PowerShell in WiX**
```xml
<CustomAction Id="RegisterExtension"
  Execute="deferred"
  Impersonate="no"
  Script="jscript"
  ... />
```
Or use WixUtilExtension's `QtExecCmdLine` to call a PowerShell script.

**Option 2: Ship a setup helper script**
Include `install-extension.ps1` with the installer, call it via custom action.
This is cleaner and easier to maintain.

**Recommended: Option 2** — ship `Installer\install-extension.ps1`.

### install-extension.ps1 Script (to be created)
```powershell
param([string]$Version = "1.1.0")

$AppData   = $env:APPDATA
$LocalData = $env:LOCALAPPDATA
$ExtId     = "ant.dir.gh.dectdan.claudedevstudio"
$ExtDir    = Join-Path $AppData "Claude\Claude Extensions\$ExtId"
$SettingsDir = Join-Path $AppData "Claude\Claude Extensions Settings"
$InstallsJson = Join-Path $AppData "Claude\extensions-installations.json"

# Step 1: Ensure extension directories exist
New-Item -ItemType Directory -Force -Path $ExtDir | Out-Null
New-Item -ItemType Directory -Force -Path "$ExtDir\server" | Out-Null
New-Item -ItemType Directory -Force -Path $SettingsDir | Out-Null

# Step 2: Copy extension files
$McpSrc = Join-Path $LocalData "ClaudeDevStudio\mcp-server"
Copy-Item "$McpSrc\index.js"      "$ExtDir\server\index.js" -Force
Copy-Item "$McpSrc\package.json"  "$ExtDir\package.json"    -Force
if (Test-Path "$ExtDir\node_modules") {
    Remove-Item "$ExtDir\node_modules" -Recurse -Force
}
Copy-Item "$McpSrc\node_modules"  "$ExtDir\node_modules"    -Recurse -Force

# Step 3: Write manifest.json
$ManifestSrc = Join-Path $LocalData "ClaudeDevStudio\mcp-server\manifest.json"
Copy-Item $ManifestSrc "$ExtDir\manifest.json" -Force

# Step 4: Register in extensions-installations.json
$Manifest = Get-Content "$ExtDir\manifest.json" -Raw | ConvertFrom-Json
$NewEntry = @{
    id            = $ExtId
    version       = $Version
    hash          = "0000000000000000000000000000000000000000000000000000000000000000"
    installedAt   = (Get-Date -Format "o")
    manifest      = $Manifest
    signatureInfo = @{ status = "unsigned" }
    source        = "local"
}
if (Test-Path $InstallsJson) {
    $Installs = Get-Content $InstallsJson -Raw | ConvertFrom-Json
} else {
    $Installs = [PSCustomObject]@{ extensions = [PSCustomObject]@{} }
}
$Installs.extensions | Add-Member -MemberType NoteProperty -Name $ExtId -Value $NewEntry -Force
$Installs | ConvertTo-Json -Depth 20 -Compress | Set-Content $InstallsJson -Encoding UTF8

# Step 5: Enable the extension
@{ isEnabled = $true } | ConvertTo-Json | Set-Content `
    (Join-Path $SettingsDir "$ExtId.json") -Encoding UTF8

# Step 6: Remove old claude_desktop_config.json entry
$ConfigPath = Join-Path $AppData "Claude\claude_desktop_config.json"
if (Test-Path $ConfigPath) {
    $Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
    if ($Config.mcpServers -and $Config.mcpServers.PSObject.Properties[$ExtId.Split('.')[-1]]) {
        $Config.mcpServers.PSObject.Properties.Remove("claudedevstudio")
        $Config | ConvertTo-Json -Depth 10 | Set-Content $ConfigPath -Encoding UTF8
    }
}

Write-Host "ClaudeDevStudio extension registered successfully."
```

### WiX Changes Needed

**Installer.wxs — add custom action:**
```xml
<!-- Property to pass version -->
<Property Id="CDS_VERSION" Value="1.1.0" />

<!-- Custom Action: run install-extension.ps1 -->
<CustomAction Id="RegisterCDSExtension"
  Directory="INSTALLDIR"
  ExeCommand='[SystemFolder]WindowsPowerShell\v1.0\powershell.exe
    -ExecutionPolicy Bypass -File "[INSTALLDIR]install-extension.ps1" -Version "[CDS_VERSION]"'
  Execute="deferred"
  Impersonate="yes"
  Return="check" />

<!-- Schedule after InstallFiles -->
<InstallExecuteSequence>
  <Custom Action="RegisterCDSExtension" After="InstallFiles">NOT Installed</Custom>
</InstallExecuteSequence>
```

**Files to add to installer harvest:**
- `manifest.json` in mcp-server dir
- `install-extension.ps1` in Installer dir

---

## 5. FILES CHANGED IN SOURCE (commit these)

| File | Change |
|------|--------|
| `mcp-server/index.js` | Added `CDS_INSTALL_PATH`, fixed 5 relative paths |
| `mcp-server/package.json` | SDK version `^0.5.0` → `^1.29.0` |
| `mcp-server/manifest.json` | NEW FILE — extension manifest |
| `Installer/install-extension.ps1` | NEW FILE — registration script |
| `Installer/Installer.wxs` | Add custom action for install-extension.ps1 |

---

## 6. VERSION BUMP

This fix warrants a **patch release**: `v1.1.0` → `v1.1.1`

Files to update version in:
1. `ClaudeDevStudio.csproj` — `<Version>`
2. `Installer/Installer.wxs` — `Version` attribute
3. `Program.cs` — ShowVersion() and ShowHelp()
4. `mcp-server/package.json` — `"version"`
5. `mcp-server/manifest.json` — `"version"`

---

## 7. TESTING CHECKLIST FOR v1.1.1

- [ ] Clean uninstall of v1.1.0
- [ ] Fresh install of v1.1.1 MSI
- [ ] Verify extension appears in Settings → Connectors
- [ ] Verify extension shows as "running" in Settings → Developer → Local MCP servers
- [ ] Verify tool permissions are listed in Settings → Connectors → ClaudeDevStudio
- [ ] Open new chat — verify claudedev_load and other tools are available
- [ ] Test `claudedev_load D:\Projects\ClaudeDevStudio`
- [ ] Test on C:\ drive project
- [ ] Test on D:\ drive project
- [ ] Verify qwen_config.json is found at correct LOCALAPPDATA path
- [ ] Verify review-server starts correctly
- [ ] Verify TrayApp auto-starts
- [ ] Test upgrade path: install over v1.1.0, verify old claude_desktop_config entry removed
- [ ] Verify node_modules at extension level have SDK 1.29.0

---

## 8. LESSONS LEARNED

1. **Claude Desktop can break you silently.** The server kept running and responding,
   but tools stopped being exposed. No error, just silence. Always check logs.

2. **The extension system has 3 separate required pieces:**
   - Extension files in `Claude Extensions\{id}\`
   - Entry in `extensions-installations.json`
   - Settings file in `Claude Extensions Settings\{id}.json` with `isEnabled: true`
   Missing ANY ONE of these means the extension doesn't launch.

3. **MCP SDK versions drift fast.** Pin to a working major version (`^1.0.0` not `^0.5.0`)
   and test on Claude Desktop updates.

4. **Never use `__dirname` for paths in an MCP server that may move.**
   Always use environment variables (`LOCALAPPDATA`, `USERPROFILE`) to find
   sibling files. The extension system moves your server to a different directory.

5. **Build sequence still matters.** Fix code, then build. Never build first.

---

*Report generated: April 4, 2026*
*Fixed by: Claude + Dan*
*Next action: Build v1.1.1 installer with proper extension registration*
