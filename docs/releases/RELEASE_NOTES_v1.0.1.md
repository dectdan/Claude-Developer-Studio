# ClaudeDevStudio v1.0.1 - Bug Fix Release

**Release Date:** February 14, 2026

## Bug Fixes

### Critical Path Handling Bug Fixed

**Issue:** The `claudedev record` and `claudedev check` commands failed when used with C:\ drive paths, making ClaudeDevStudio unusable for projects on the C:\ drive.

**Root Cause:** These commands used `Directory.GetCurrentDirectory()` instead of accepting a `project_path` parameter like the `init` and `load` commands do.

**Fix:** 
- Updated `RecordData()` and `CheckAction()` methods to accept `project_path` as first argument
- Updated MCP server to use PowerShell explicitly for better quote handling
- Both C:\ and D:\ drive paths now work correctly

### Changes

**Program.cs:**
```csharp
// BEFORE (broken):
var projectPath = Directory.GetCurrentDirectory();
var type = args[1].ToLower();

// AFTER (fixed):
var projectPath = args[1];
var type = args[2].ToLower();
```

**mcp-server/index.js:**
```javascript
// BEFORE:
const command = `"${CLAUDEDEV_PATH}" ${args}`;

// AFTER:
const command = `powershell.exe -Command "& '${CLAUDEDEV_PATH}' ${args}"`;
```

### Verification

Tested with both C:\ and D:\ paths:
```bash
claudedev record 'C:\Projects\SmartScribe_NEW' activity '{...}'
✓ Recorded activity: test

claudedev record 'C:\Projects\SmartScribe_NEW' mistake '{...}'
✓ Recorded mistake: Built custom text editor from scratch
```

## Files Changed

- `Program.cs` - Fixed `RecordData()` and `CheckAction()` methods
- `mcp-server/index.js` - Added PowerShell wrapper for better quote handling
- `ClaudeDevStudio.csproj` - Version bumped to 0.1.1
- `Installer/Installer.wxs` - Version bumped to 1.0.1.0

## Installation

Download: [ClaudeDevStudio-v1.0.1.msi](https://github.com/dectdan/Cloud-Developer-Studio/releases/download/v1.0.1/ClaudeDevStudio-v1.0.1.msi)

**Important:** Uninstall v1.0.0 before installing v1.0.1.

## Breaking Changes

None - this is a bug fix release that maintains backward compatibility.

## Upgrade Notes

If you have projects initialized with ClaudeDevStudio v1.0.0:
1. Your project memory will be preserved
2. The `record` and `check` commands will now work correctly with C:\ paths
3. No manual migration needed

---

**Previous Release:** [v1.0.0](https://github.com/dectdan/Cloud-Developer-Studio/releases/tag/v1.0.0)
