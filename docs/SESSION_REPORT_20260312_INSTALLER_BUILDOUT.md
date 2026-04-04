# Session Report — Installer Build-Out
**Date:** 2026-03-12  
**Session Type:** Build Engineering  
**Author:** Claude (AI pair programmer)  
**Status:** COMPLETE ✅

---

## What We Were Trying To Do

Wire up a complete, single-EXE installer for ClaudeDevStudio that bundles every component 
of the product so a user on a clean machine can double-click and get a fully working install 
with no manual steps.

The installer already existed and built successfully from a prior session (374 MB, VoiceServer 
+ MCP server only). The goal this session was to finish the build-out by adding the remaining 
three missing components: CLI, Dashboard, and VSIX.

---

## What the Installer Does (End-to-End)

When a user runs ClaudeDevStudio-Setup.exe, it:

1. Checks for .NET 8 via registry — downloads silently (~60 MB) if missing
2. Checks for Node.js via exit code — downloads silently (~30 MB) if missing
3. Installs all CDS files to `%LOCALAPPDATA%\ClaudeDevStudio\`
4. Skips npm install if node_modules is bundled (it is — 5 MB, saves install time)
5. Checks for kokoro.onnx — downloads if not bundled (it is — 310 MB bundled)
6. Installs VSIX into VS 2022 if detected (reads registry SOFTWARE\Microsoft\VisualStudio\17.0)
7. Runs ConfigureClaudeDesktop.ps1 to write MCP entry into claude_desktop_config.json
8. Creates Documents\ClaudeDevStudio\Projects and Backups folders
9. Writes uninstall registry key, autostart entry, Start Menu shortcut
10. Writes Uninstall.exe

---

## Three Problems Found and Fixed

### Problem 1: CLI Build Failing (Duplicate Assembly Attributes)

**Symptom:** `dotnet publish` on ClaudeDevStudio.csproj failed with ~15 CS0579 errors 
("Duplicate AssemblyCompanyAttribute", etc.) plus CS0246 (KokoroSharp not found).

**Root Cause:** The root .csproj uses `<Project Sdk="Microsoft.NET.Sdk">` which auto-includes 
all .cs files under the project root. The VoiceServer subfolder (`VoiceServer\Program.cs`) 
was being compiled into the CLI project, pulling in KokoroSharp references that don't exist 
in that project, and duplicating all assembly attributes from the VoiceServer obj folder.

**Fix:** Added VoiceServer to the exclusion list in ClaudeDevStudio.csproj:
```xml
<Compile Remove="VoiceServer\**" />
<EmbeddedResource Remove="VoiceServer\**" />
<None Remove="VoiceServer\**" />
```

**Result:** CLI built clean. Output: `claudedev.exe` → `build\CLI\`

---

### Problem 2: VSIX Build Failing (Missing VSSDK Targets)

**Symptom:** MSBuild error MSB4226 — `Microsoft.VsSDK.targets` not found.

**Root Cause:** Two sub-problems:
1. The VSIX .csproj was missing `<RuntimeIdentifiers>win</RuntimeIdentifiers>`, which caused 
   NuGet restore to fail with "project file doesn't list 'win' as a RuntimeIdentifier."
2. Even after adding that, the build was still failing because the build script was using 
   MSBuild from VS 2022 **Build Tools** (`C:\Program Files (x86)\...BuildTools\...`), which 
   does NOT include the VSSDK targets. VSIX projects require the full VS IDE installation's 
   MSBuild.

**Fixes:**
1. Added `<RuntimeIdentifiers>win</RuntimeIdentifiers>` to CdsVsBridge.csproj
2. Updated build-setup.ps1 to look for MSBuild from the VS 2022 Community/Professional/Enterprise 
   IDE installation first, falling back to BuildTools only if none found:
   ```powershell
   $vsMsbuildPaths = @(
       "${env:ProgramFiles}\Microsoft Visual Studio\2022\Enterprise\MSBuild\Current\Bin\MSBuild.exe",
       "${env:ProgramFiles}\Microsoft Visual Studio\2022\Professional\MSBuild\Current\Bin\MSBuild.exe",
       "${env:ProgramFiles}\Microsoft Visual Studio\2022\Community\MSBuild\Current\Bin\MSBuild.exe"
   )
   ```
   VS 2022 Community was confirmed installed with VSSDK targets at:
   `C:\Program Files\Microsoft Visual Studio\2022\Community\MSBuild\Microsoft\VisualStudio\v17.0\VSSDK\`

**Result:** VSIX built clean. Output: `CdsVsBridge.vsix` → `build\VSExtension\`

---

### Problem 3: Dashboard Not Wired Up

**Symptom:** Dashboard was simply never added to the build script from the prior session.

**Fix:** Added step 4 (of 7) to build-setup.ps1:
```powershell
dotnet publish "$Root\ClaudeDevStudio.Dashboard\ClaudeDevStudio.Dashboard.csproj" \
    -c Release -r win-x64 --self-contained false -o "$Build\Dashboard"
```

**Notes:** Dashboard is WinUI 3 (`net8.0-windows10.0.19041.0`). It builds and publishes 
successfully. There is one benign warning: NETSDK1198 about a missing `win-AnyCPU.pubxml` 
publish profile — this is harmless, the output is correct.

**Result:** Dashboard built clean. Output: `ClaudeDevStudio.Dashboard.exe` → `build\Dashboard\`

---

## Other Changes Made

### node_modules Bundled (npm install no longer runs on target machine)

The mcp-server node_modules folder is only 5 MB. Rather than running npm install at install 
time (which requires internet access and adds installation time), the build script now copies 
the entire node_modules directory into the build staging area. The NSIS script was updated to 
check — if node_modules already exists, it skips npm install entirely.

### NSIS Script: Zero Warnings Final State

After all components were bundled, NSIS compiled with zero warnings. Previously there were 
3 "no files found" warnings for CLI, Dashboard, and VSIX.

---

## Final Build Output

| Metric | Value |
|--------|-------|
| EXE size | **381 MB** |
| LZMA compression ratio | 55.8% (from 715 MB raw) |
| NSIS warnings | 0 |
| Build time | ~320 seconds |
| Build script | `Installer\build-setup.ps1` |
| Output EXE | `Installer\Output\ClaudeDevStudio-Setup.exe` |

### Components Bundled

| Component | Source | Destination |
|-----------|--------|-------------|
| VoiceServer.exe | `VoiceServer\` → dotnet publish | `build\VoiceServer\` |
| kokoro.onnx (310 MB) | `%LOCALAPPDATA%\ClaudeDevStudio\VoiceServer\` | `build\VoiceServer\` |
| claudedev.exe (CLI) | `ClaudeDevStudio.csproj` → dotnet publish | `build\CLI\` |
| ClaudeDevStudio.TrayApp.exe | `ClaudeDevStudio.UI\` → dotnet publish | `build\TrayApp\` |
| ClaudeDevStudio.Dashboard.exe | `ClaudeDevStudio.Dashboard\` → dotnet publish | `build\Dashboard\` |
| CdsVsBridge.vsix | `VSExtension\CdsVsBridge\` → MSBuild | `build\VSExtension\` |
| index.js + node_modules | `mcp-server\` → direct copy | `build\mcp-server\` |
| ConfigureClaudeDesktop.ps1 | `Installer\` → direct copy | `build\` |

---

## Key Technical Facts for Future Reference

### Why BuildTools MSBuild Can't Build VSIX
VS Build Tools is a stripped-down MSBuild host that doesn't include the VS SDK targets 
(`Microsoft.VsSDK.targets`). VSIX projects import this target file which lives only inside 
a full VS IDE installation. Always use the IDE's MSBuild for VSIX projects.

### Why CLI csproj Pulls in VoiceServer Files
`Microsoft.NET.Sdk` projects use glob patterns by default — they include `**\*.cs` from the 
project root. Since VoiceServer is a subdirectory of the same root where ClaudeDevStudio.csproj 
lives, its .cs files get swept in. The fix is always to add explicit `<Compile Remove="...">` 
entries for any sibling project folders that share the same root.

### NSIS `/nonfatal` on File Directives
All `File` directives in setup.nsi use `/nonfatal` so a missing component (e.g. VSIX not built) 
doesn't abort the entire installer compile. This lets the installer still produce a usable EXE 
even when optional components aren't available.

### Dashboard Warning (NETSDK1198)
The Dashboard .csproj has `<PublishProfile>win-$(Platform).pubxml</PublishProfile>` which 
resolves to `win-AnyCPU.pubxml` when Platform isn't set. That file doesn't exist. This is 
purely a cosmetic warning — the output is correct. Fix if it bothers you: either create the 
.pubxml file or remove the PublishProfile property from the .csproj.

---

## What's NOT Done Yet (Pending)

- **Test the installer** on a clean machine (Dan will test on a laptop)
- **Phase 3** — Push/poll events in VS Bridge
- **Phase 4** — Exception auto-intercept
- **GitHub Actions** — VSIX build step needs the Community MSBuild path logic added to the CI yml
  (CI uses Build Tools by default; same problem as above will hit in CI)

---

## Files Modified This Session

| File | Change |
|------|--------|
| `Installer\build-setup.ps1` | Complete rewrite — added CLI, Dashboard, VSIX steps; hardcoded VS IDE MSBuild lookup; bundled node_modules; 7-step build |
| `ClaudeDevStudio.csproj` | Added `<Compile Remove="VoiceServer\**" />` (and EmbeddedResource, None) |
| `VSExtension\CdsVsBridge\CdsVsBridge.csproj` | Added `<RuntimeIdentifiers>win</RuntimeIdentifiers>` |
| `Installer\setup.nsi` | Updated npm install step to skip if node_modules already present |

---

*Report written by Claude. Next session: read this doc and check the handoff doc at*  
*`docs\HANDOFF_VSBRIDGE_PHASE1_20260312.md` before starting Phase 3 work.*
