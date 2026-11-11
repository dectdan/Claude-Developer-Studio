# P2 Output — A fresh install that just works

*2026-11-11, Claude Code (Opus 5.5), unattended. Prompt: `docs\P2_prompt.md`. Nothing was installed, uninstalled or deployed on Dan's PC; the installer ran only in Windows Sandbox. No tag, no release.*

---

## For Dan: review, then publish v1.3.0

The producer will walk you through it. In short:

1. **Review** this file and the commit (`P2: installer keeps other servers and keys, ...`).
2. **Publish v1.3.0** on GitHub by hand: a new release `v1.3.0`, attach `Installer\Output\ClaudeDevStudio-Setup.exe` (194.1 MB, SHA-256 `CB86B708697FA7A25B0DC686A4E98C0C4620D5DBD0DAB1A4AE3F5DD980F3186D`, built 2026-11-11 13:51:12), and paste `docs\releases\RELEASE_NOTES_v1.3.0.md` as the text. This is the exact EXE the sandbox passed 41/41 with (the sandbox recorded the same SHA-256).
3. **On your own PC**, installing v1.3.0 is safe now: it keeps your 7 other servers, `preferences` and `coworkUserFilesPath`, backs up `claude_desktop_config.json` first, keeps your API keys, and installs the VS Bridge into VS 2022 Community (close Visual Studio first; Build Tools will refuse it, which is only logged). It also covers your P1 step (the new VSIX). Afterwards quit Claude Desktop fully and reopen it, and run `node D:\Projects\ClaudeDevStudio\mcp-server\test\caller-check.mjs http://localhost:62000` with VS open.

---

## Results at a glance

| Check | Result |
|---|---|
| **Windows Sandbox, new user, networking off** (run `20261111-135154`) | **41 passed, 0 failed** in 12.8 min (A install, B upgrade, C uninstall, D Documents redirected) |
| `config-merge-test.js` (the merge script on throwaway files) | 28 passed, 0 failed |
| `smoke.mjs` (installed CLI) / `smoke.mjs --cli bin\Release\net8.0\claudedev.exe` | **16/16** / **24/24** |
| Builds: CLI / TrayApp / Dashboard / VSIX | 0 errors; 42 / 23 / 9 / 12 warnings (same as P1, none new) |
| NSIS | 0 warnings |
| `tools\check-versions.ps1` | all 15 places 1.3.0 (16 before: `install-extension.ps1` is gone) |
| `release.yml` | parses (PyYAML): `workflow_dispatch` only, 6 steps |
| `deploy.ps1 -DryRun` | lists 10 files to replace, 5 the same; never mentions the keys file; changes nothing |
| Path search | no Dan-specific path left in shipped code; two usage comments in the producer's `tools\phase\` scripts left on purpose (below) |

---

## Decisions I made

1. **The merge is `Installer\cds-config.js`, run by NSIS directly with the full `node.exe` path** it finds (the same three places as before, re-checked after the Node install). `install-extension.ps1` and `ConfigureClaudeDesktop.ps1` became dead and were removed with `git rm`; `tools\check-versions.ps1` dropped its row for `install-extension.ps1` and the comment in `Directory.Build.props` was updated.
2. **Details of the merge:** the file is written with 2-space indentation (Claude Desktop's own style), so values are kept exactly but whitespace may change. An already up-to-date file is not rewritten (and then needs no backup). An empty file counts as `{}`. A file whose `mcpServers` isn't an object is treated like invalid JSON: untouched, exit code 2. A BOM on the existing file is dropped (written without one).
3. **The old Claude Extensions clean-up moved into `cds-config.js`** too: the PowerShell version rewrote `extensions-installations.json` with `ConvertTo-Json` and a BOM (the same bug class).
4. **`claudedev configure-claude` (the tray app's "Link Claude Desktop" menu) had the same bug**: it rewrote the whole config as one entry, deleting every other server and even `cds-workbench`. `Program.cs` is outside P2's list, but shipping that menu would undo item 14, so it now runs the installed `cds-config.js` (argument list, no shell) and reports its result. Sandbox-checked.
5. **The installer now bundles the .NET 8 Desktop Runtime** (58 MB; the EXE went from ~138 to 194 MB). With networking off (as the prompt requires) the old .NET download could not work, and it fetched only the base runtime although the tray app needs the Desktop runtime; the old check also looked for a registry value `8.0.0` that rarely exists. It now looks for `dotnet\shared\Microsoft.WindowsDesktop.App\8.*`.
6. **The user PATH is edited by `Installer\cds-path.ps1`**, not NSIS: NSIS strings stop at 1024 characters, so reading and writing back a long PATH could cut it (or, on uninstall, empty it). It adds the CLI folder once (no duplicate on upgrade) and removes only that folder, keeping the value's type and `%VARIABLES%`. Sandbox-checked with a 1,718-character PATH.
7. **The auto-start (Run) entry is written on a first install only,** so an upgrade doesn't undo a user who turned auto-start off.
8. **VSIX manifest range widened to `[17.0, 19.0)`** (VS 2022 and VS 2026), outside P2's list: with `[17.0, 18.0)` VSIXInstaller refuses VS 2026, so "any Visual Studio" would not be true. Not tested on VS 2026 (none here).
9. **`cds-vsix.ps1` targets every instance with `VSIXInstaller.exe`, Build Tools included,** as the prompt says; Build Tools refuse it (exit 2001, logged). Each call has a 300 s limit. `-ListOnly` added for checking on a developer PC.
10. **Every `File` in `setup.nsi` is now fatal** (no `/nonfatal`): a missing component fails the build instead of shipping without it. `build-setup.ps1` stops at the first failed step.
11. **Silent mode:** `/S` already worked in NSIS; every `MessageBox` now has `/SD IDOK` so a silent install or uninstall can't block. The finish text is set at run time (normal, Node missing, invalid config, other error).
12. **Install steps are logged to `%LOCALAPPDATA%\ClaudeDevStudio\install.log`** (also in silent mode); the uninstaller logs to `%TEMP%\ClaudeDevStudio-uninstall.log` (the install folder is gone by then).
13. **`build-setup.ps1` installs the servers' dependencies with `npm ci --omit=dev`** from the lockfiles instead of copying the source's `node_modules`, and checks each bundled runtime's Authenticode signature (Node: OpenJS Foundation; .NET; Windows App Runtime: Microsoft). Downloads are cached in `Installer\downloads\` (gitignored); I copied the two already in `Installer\build\` there, so only the .NET runtime was downloaded. Node stays at 22.14.0 (not upgraded in P2; see "Not done").
14. **`Bundled\` removed entirely**, including `Dbgview.chm` and `Eula.txt`: they are DebugView's own help and licence, useless without it.
15. **Also removed or moved,** after checking nothing builds from them: `Installer\build-installer.ps1` (WiX build, Dan's paths), `Installer\License.rtf` (only `Installer.wxs` used it), `Installer\Package.appxmanifest` (only `Build-MSIX.ps1` read it; nothing read the root one). `Installer\test-dashboard.ps1` and `create-icon.ps1` (Dan's paths, one-off scripts) moved to `docs\history\attic\`; `Installer\landing-page.html` and `CompletionMessage.txt` to `docs\history\installer\` with the `.md` files; `Releases\RELEASE_NOTES*.md` to `docs\releases\` (v1.0.0's renamed `RELEASE_NOTES_v1.0.0.md`). Untracked local leftovers (`MCP\node_modules`, `VoiceServer\bin`, `Releases\*.exe`) were not deleted, only ignored.
16. **`release.yml` is manual-only** (`workflow_dispatch`), runs `Installer\build-setup.ps1` on `windows-2022` and uploads the EXE as an artifact, with no release step: it has never run on GitHub's runner (I could not run it without pushing a tag), and §10 says releases are published by hand.
17. **`deploy.ps1`** publishes the CLI fresh into `%TEMP%` (so it never deploys a stale `bin\Release`), compares by content, keeps backups in `%LOCALAPPDATA%\ClaudeDevStudio\_deploy_backups\<time>\` (one folder per deploy rather than `.bak` files scattered in `CLI\`), also copies the two `package-lock.json` files and runs `npm ci --omit=dev` when a package file changed. It no longer stops or restarts the Review Panel or tray app; it says when the panel needs a restart.
18. **README:** no e-mail address; problems go to GitHub issues. It says plainly that the tray app checks GitHub for updates at start (the only call the user didn't ask for).
19. **Uninstall removes `qwen_config.json`** with `mcp-server\` (what NSIS does with the folder, as the prompt says). README and release notes say so.
20. **Example paths in `index.js`** (`D:\Projects\MyApp` in the `project_path` description and error) changed to `C:\Projects\MyApp`.
21. **`.gitignore`:** root-only patterns are anchored (`/Releases/`): on Windows `Releases/` also matched `docs\releases\` and hid the new release notes.
22. **Not committed: `tools\phase\phase-status.ps1`** has an uncommitted change that isn't mine (the producer's, reading the run log with shared access). I left it for the producer.

---

## The work, with evidence

### 1. The installer keeps everything that isn't CDS's (§7 item 14)
`Installer\cds-config.js` (`install` / `uninstall`): keeps every other `mcpServers` entry and top-level key; replaces only `claudedevstudio` and `cds-workbench` in place; creates the folder and file if missing; backs up to `claude_desktop_config.json.bak-cds-YYYYMMDD-HHMMSS` (with `-2`, `-3` if the name exists); writes a temp file, fsyncs, renames; UTF-8 without BOM; leaves invalid JSON untouched with exit 2, and writes the two entries to `%LOCALAPPDATA%\ClaudeDevStudio\ADD-TO-CLAUDE-CONFIG.txt`; the finish page then names the config file and that text file. Uninstall: same rules; Node missing or invalid JSON → a message box (`/SD IDOK`) says what to remove by hand.
- `node tools\sandbox-test\config-merge-test.js`: 28/28 (BOM'd seed with a Unicode `env` value; second install changes nothing; upgrade from old paths replaces in place and keeps order; invalid JSON untouched for install and uninstall; wrong-type `mcpServers`; no folder; empty file; uninstall equals the seed exactly; old extension registration removed, others kept).
- Sandbox A/B/C/D: every config check passed (table below).

### 2. Upgrades keep the user's API keys (§7 item 15)
- `build-setup.ps1` stages `qwen_config.template.json` under its own name and fails the build if a `qwen_config.json` is staged.
- `setup.nsi`: after the files are copied, `qwen_config.json` is created from the template only if it doesn't exist. No step writes it otherwise.
- **Uninstall deletes it** with `mcp-server\` (sandbox C: "exists after uninstall: False").
- **Other things the user can change after install, checked the same way:**

| What | Where | Install / upgrade | Uninstall |
|---|---|---|---|
| API keys | `mcp-server\qwen_config.json` | created once, never overwritten | removed with `mcp-server\` |
| Claude Desktop config | `%APPDATA%\Claude\claude_desktop_config.json` | only CDS's two entries; backup first | only CDS's two entries; backup first |
| User PATH | `HKCU\Environment\Path` | CLI folder added once; rest unchanged | CLI folder removed; rest unchanged |
| Auto-start | `HKCU\...\Run\ClaudeDevStudio` | written on a first install only | removed |
| DebugView the user adds | `%LOCALAPPDATA%\ClaudeDevStudio\DebugView\` | never touched | kept (the folder stays if it's there) |
| Dashboard settings | `%APPDATA%\ClaudeDevStudio\settings.json` | never touched | kept |
| Memory | `[Documents]\ClaudeDevStudio\` | only creates `Projects\`, `Backups\` | kept |
| Config backups | `%APPDATA%\Claude\*.bak-cds-*` | written | kept |

### 3. The VS Bridge for any Visual Studio (§7 item 16)
`Installer\cds-vsix.ps1 -Action install|uninstall`: `vswhere -all -prerelease -products * -format json`, every instance with `Common7\IDE\VSIXInstaller.exe`, `/quiet /instanceIds:<id>` with the VSIX (or `/uninstall:CdsVsBridge.DanGain.ClaudeDevStudio`), exit codes named in the log, always exits 0. Found and fixed while testing: Windows PowerShell 5.1's `ConvertFrom-Json` returned the instance array as one object, which would have passed all three instances to one call.
- On Dan's PC, `-ListOnly` (runs nothing): Build Tools 2022 (67078cbd), **Community 2022 (c7705ad0)**, Build Tools 2019 (de4c6b4b), each with its own `VSIXInstaller.exe`.
- Sandbox (no VS): `Skipped: Visual Studio not found (no vswhere.exe). The VS Bridge is optional.`, install continues.

### 4. No Dan-specific paths; the repo cleaned up (§7 items 3, 4, 11)
**Search** (tracked `*.cs *.js *.mjs *.ps1 *.nsi *.json *.xaml *.csproj *.yml` outside `docs\`, case-insensitive `D:\ | D:/ | C:\Users | C:/Users | Big_D | \Dan\ | /Dan/ | D:\Tools | OneDrive`):

| Found before | Fixed |
|---|---|
| `VSDebugMonitor.cs`: `D:\Tools\DebugView\dbgview64.exe` | looks in `%LOCALAPPDATA%\ClaudeDevStudio\DebugView\`, then `PATH`; message below |
| `Installer\build-setup.ps1`: `$Root = "D:\Projects\ClaudeDevStudio"` | `$PSScriptRoot` |
| `deploy.ps1`: `$Src = "D:\Projects\ClaudeDevStudio"` | `$PSScriptRoot` |
| `install.ps1`: `cd D:\Projects\ClaudeDevStudio` | moved to `docs\history\attic\` |
| `Installer\build-installer.ps1` (5 lines) | removed (WiX era) |
| `Installer\create-icon.ps1` (3), `Installer\test-dashboard.ps1` (1) | moved to `docs\history\attic\` |
| `mcp-server\index.js`: example `D:\Projects\MyApp` (2) | `C:\Projects\MyApp` |
| `tools\phase\run-phase.ps1`, `phase-status.ps1`: a usage comment `-Project D:\Projects\ClaudeDevStudio` | **left:** the producer's own tools (not in the installer), one has the producer's uncommitted change, and it's an example in a comment |

**After** (ripgrep, the same pattern, every tracked file type listed above, excluding `docs\`, `node_modules`, `bin`, `obj`, build output and backups): the only hits left are the two `tools\phase` comments above; the word "OneDrive" in comments, help text and the `BackupStrategy.OneDrive` name; and two generic fallbacks: `index.js` (`%USERPROFILE%\OneDrive\Documents` if PowerShell can't answer) and `workbench.js` (probes `OneDrive\Documents` for the VS Bridge folder; see "Not done"). None is in a shipped file's code path. `C:\Users\Dan` was already fixed in P1. (A first pass with `grep` in Git Bash silently mangled the backslashes and missed the `tools\phase` comments; the ripgrep pass is the one to trust.)

**A slip to report:** the ripgrep pass also matched Dan's own `mcp-server\qwen_config.json` in the source folder (gitignored, never committed), because I didn't exclude it. The tool printed one line of it, its `log_path` (a path under Dan's OneDrive Documents); no key was printed, and the file wasn't opened, copied or changed otherwise. The repo's `qwen_config.template.json` has no such line.

**`VSDebugMonitor.cs`** when DebugView is missing now prints:
```
ERROR: DebugView not found.

The debug monitor needs Sysinternals DebugView, which ClaudeDevStudio does not include.
Download it from Microsoft: https://learn.microsoft.com/sysinternals/downloads/debugview
Then put dbgview64.exe in C:\Users\<you>\AppData\Local\ClaudeDevStudio\DebugView
or in any folder on your PATH, and run the monitor again.
```
(The `claudedev_monitor_start` description already says it needs DebugView.)

**`git rm`** (history untouched): `Bundled\` (Dbgview.exe, Dbgview64a.exe, dbgview64.exe, Dbgview.chm, Eula.txt); `Releases\ClaudeDevStudio-v1.0.0.msi`, `-v1.0.1.msi`; `Installer\Output\` ClaudeDevStudio-v1.0.1.wixpdb, ClaudeDevStudio.wixpdb, Dashboard.wxs, DashboardFiles.wxs, MCPServerFiles.wxs; `mcp-server\claudedev.exe`; `MCP\` (4 files); `VoiceServer\` (2 files); `Installer\` Build-MSI.ps1, Build-MSIX.ps1, Installer.wxs, Installer.wxs.backup, Installer_Complete.wxs, License.rtf, Package.appxmanifest, build-installer.ps1, install-extension.ps1, ConfigureClaudeDesktop.ps1; root `Package.appxmanifest`.
**Checked first:** `git grep` found these names only in each other, in the removed WiX outputs, in `docs\`, and in the old `release.yml`/`deploy.ps1` (both rewritten). Neither solution lists them; `ClaudeDevStudio.csproj`'s `Remove="VoiceServer\**"` lines are harmless and left. `build-setup.ps1` then built everything (twice).
**`git mv`:** `Installer\*.md` (10), `landing-page.html`, `CompletionMessage.txt` → `docs\history\installer\`; `install.ps1`, `test-dashboard.ps1`, `create-icon.ps1` → `docs\history\attic\`; `Releases\RELEASE_NOTES*.md` → `docs\releases\`.
**`.gitignore`:** `*.bak_*`, `*.bak-cds-*`, `Installer/build/`, `Installer/downloads/`, `Installer/Output/`, `tools/sandbox-test/results/`, `/Releases/`, `/VoiceServer/`, `/MCP/`, any `qwen_config.json`.

### 5. `release.yml` (§7 item 9)
VoiceServer and the Kokoro download are gone. It runs `Installer\build-setup.ps1`, so it builds exactly what a local build does, including the VSIX with Visual Studio's MSBuild (found by `vswhere`; `dotnet build` can't build it). Manual-only (decision 16). PyYAML: `{"on": {"workflow_dispatch": null}, "steps": ["Checkout", "Setup .NET 8", "Setup Node.js", "Install NSIS", "Build the installer (Installer\\build-setup.ps1)", "Upload the installer"]}`.

### 6. A safe `deploy.ps1` (§7 item 10)
Rewritten (decision 17). **Run with `-DryRun` only:**
```
>> CLI (dotnet publish, Release)
   OK  [DRY] CLI\claudedev.deps.json / claudedev.dll / claudedev.exe / claudedev.pdb  (replaced; backup in _deploy_backups\20261111_1332)
>> MCP servers
   OK  [DRY] mcp-server\index.js, workbench.js, package.json, package-lock.json  (replaced; ...)
>> Review Panel
   OK  [DRY] review-server\server.js, package.json  (replaced; ...)
   [DRY] would run npm ci --omit=dev in mcp-server / in review-server
Would deploy 10 file(s); 5 already the same.
Quit Claude Desktop fully and reopen it.
```
`Select-String qwen` on the output: 0 lines. Only the files listed above can ever be written.

### 7. `index.js`, two small things
- `claudedev_stats` prints "(Includes older entries from …)" only when a counted activity or mistake came from the old store (`entrySource`, as `buildContext`). Checked with a throwaway project and a throwaway old-store folder (both removed): no old folder → no note; empty old folder → no note; one old entry → note, and it is counted. Real projects (read-only, `show.mjs`): ClaudeDevStudio and SynapseBridge show no note now (after D2 every old entry is also in the real store).
- `similarMistakes` builds a mistake's words from `` `${m.mistake ?? ''} ${m.lesson ?? ''}` ``, as the CLI does.
- Smoke: 16/16 (installed CLI); 24/24 (`--cli bin\Release\net8.0\claudedev.exe`); in the sandbox 22/22 (A: the old-store checks skip because both folders are the same there) and 24/24 (D).

### 8. A README for strangers
`README.md` rewritten: what CDS is and that it's free; needs (Windows 10/11 x64, Claude Desktop, VS optional); install (download, run, quit and reopen Claude Desktop) and what it does to the config; first use ("Load CDS for C:\path\to\my\project"); what each part does; where the data lives and what leaves the PC; the optional keys (tray app, never shipped, never uploaded, kept on upgrade); uninstall (memory kept, keys file removed); the way of working in two lines (v1.4); problems → GitHub issues; building from source.

### 9. The installer
`Installer\build-setup.ps1` (decisions 10, 13): exit 0, 2.2 min (3.4 min with the .NET download).
- **`Installer\Output\ClaudeDevStudio-Setup.exe`: 203,570,610 bytes (194.1 MB), SHA-256 `CB86B708697FA7A25B0DC686A4E98C0C4620D5DBD0DAB1A4AE3F5DD980F3186D`, built 2026-11-11 13:51:12.**
- `check-versions.ps1` (run by the build before NSIS): all 15 places 1.3.0. In the sandbox the installed `claudedev version` printed `ClaudeDevStudio v1.3.0`.

### 10. Windows Sandbox tests as a new user
`tools\sandbox-test\`: `run-sandbox-test.ps1` (host: writes the `.wsb`, launches it, waits, reports; refuses to start if a sandbox is running), `in-sandbox.ps1` (the scenarios), `check-config.js` and `mcp-probe.mjs` (helpers run with the installed Node), `config-merge-test.js` (host unit test). The `.wsb`: networking **disabled**, vGPU and clipboard off, 6 GB; the installer folder, the kit and `mcp-server\test` mapped **read-only**, `results\<run>\` writable; `LogonCommand` runs `in-sandbox.ps1`. **Time limit 60 min** (`-TimeoutMinutes`); after it the sandbox processes are stopped and the run reported as a timeout (exit 2). The script ends with `shutdown /s /t 0`; the sandbox window didn't close on its own within 3 min, so the runner closed it (`WindowsSandboxRemoteSession`) after `results.json` said finished. Nothing was left running.

Beyond the prompt's checks the test also seeds a 1,718-character user PATH with `%USERPROFILE%`, and checks auto-start, `claudedev configure-claude`, a backup on uninstall, registry and Start menu clean-up, and that the memory survives the uninstall too.

The first run (`20261111-133317`) had 35 passed / 6 failed; all 6 were the test's own faults: Node's MSI adds `%APPDATA%\npm` to the user PATH (the expected value didn't allow for it), and the uninstaller's temp copy is `~nsuN.tmp\Un.exe`, which my wait didn't recognise, so C was checked mid-uninstall. Both fixed; the final run is below.

**Final run `20261111-135154`, installer SHA-256 `CB86B708…3186D`: 41 passed, 0 failed (12.8 min).** Sandbox: `WDAGUtilityAccount`, elevated, Windows 11 Enterprise 10.0.26100, 0 network adapters up, no Node, no .NET, no Visual Studio.

| | Check | Result | Evidence |
|---|---|---|---|
| A | installer `/S` exits 0 | PASS | exit 0 after 649 s |
| A | program files are in place | PASS | 15 files present |
| A | `claudedev version` prints 1.3.0 | PASS | `ClaudeDevStudio v1.3.0` |
| A | Node.js is installed | PASS | `C:\Program Files\nodejs\node.exe` v22.14.0 |
| A | config: both CDS entries (full `node.exe`, files exist); keep-me, preferences, someOtherSetting unchanged; no BOM | PASS | servers keep-me, claudedevstudio, cds-workbench; keep-me `{"command":"cmd","args":["/c","echo"]}`; preferences `{"sidebarMode":"chat"}`; 42; BOM False |
| A | config backup exists and equals the file before install | PASS | `claude_desktop_config.json.bak-cds-20261111-140257` |
| A | `qwen_config.json` exists with all keys empty | PASS | together, groq, deepinfra, fireworks, openrouter: empty |
| A | user PATH kept (plus Node's npm folder), CLI added once, still REG_EXPAND_SZ | PASS | length 1828 = expected |
| A | auto-start entry written on a first install | PASS | |
| A | memory server smoke test (installed `index.js` + installed CLI) | PASS | 22 passed, 0 failed |
| A | workbench server lists 13 tools | PASS | 13 |
| A | Review Panel from the installed files: `caller-check.mjs` | PASS | 7 passed, 0 failed |
| A | memory lands in `[Documents]\ClaudeDevStudio\Projects\SandboxProj` | PASS | `C:\Users\WDAGUtilityAccount\Documents\ClaudeDevStudio\Projects\SandboxProj`; activity file written |
| A | `claudedev configure-claude` exits 0 | PASS | "Already up to date; file not rewritten. Kept 1 other server(s): keep-me" |
| A | config after `configure-claude`: all kept, each CDS entry once | PASS | |
| B | test key put into `qwen_config.json` (groq) | PASS | |
| B | installer `/S` exits 0 | PASS | 21 s |
| B | the API key is still there (others still empty) | PASS | |
| B | config: keep-me, preferences, someOtherSetting unchanged; each CDS entry once | PASS | |
| B | memory from A untouched | PASS | 7 items, same hashes |
| B | user PATH: CLI once, rest unchanged | PASS | length 1828 |
| B | `claudedev version` still 1.3.0 | PASS | |
| C | uninstaller `/S` ran to the end | PASS | 11 s (waited for `~nsu1.tmp\Un.exe`) |
| C | config: CDS entries gone; keep-me, preferences, someOtherSetting remain; no BOM | PASS | servers: keep-me |
| C | config backed up before the uninstall changed it | PASS | 1 → 2 backups |
| C | memory folder under Documents untouched | PASS | 11 items, same hashes |
| C | keys file: removed with the install folder (as documented) | PASS | `qwen_config.json` gone |
| C | no CDS files left in the install folder | PASS | `%LOCALAPPDATA%\ClaudeDevStudio` removed |
| C | user PATH exactly as before CDS (Node keeps its npm folder) | PASS | length 1766 = expected |
| C | registry entries and Start menu folder removed | PASS | |
| C | kept on purpose: Node.js and .NET still installed | PASS | .NET Desktop 8.0.34 |
| D | `MyDocuments` (new process) returns RedirectedDocs | PASS | `C:\Users\WDAGUtilityAccount\RedirectedDocs` |
| D | installer `/S` exits 0 | PASS | 22 s |
| D | program files are in place | PASS | |
| D | `claudedev version` prints 1.3.0 | PASS | |
| D | Node.js is installed | PASS | |
| D | config: both CDS entries added again; the rest unchanged | PASS | |
| D | memory server smoke test | PASS | 24 passed, 0 failed |
| D | memory lands in `RedirectedDocs\ClaudeDevStudio\Projects\SandboxProjD` | PASS | |
| D | installer made its data folders under RedirectedDocs | PASS | Projects, Backups |
| D | nothing CDS-related created or changed in `C:\Users\WDAGUtilityAccount\Documents` | PASS | 12 items, same before and after |

**Kept on purpose by the uninstall:** the memory in Documents, Claude Desktop config backups (`*.bak-cds-*`), Node.js, the .NET 8 Desktop Runtime, the Windows App Runtime, a user's `DebugView\` folder and `%APPDATA%\ClaudeDevStudio\settings.json` if they exist.

**Where the first install's time goes** (from the timestamped `install.log` lines): .NET 8 Desktop Runtime 8 min 10 s, Node.js 2 min 10 s, Windows App Runtime 10 s, CDS itself under 5 s. The .NET time is probably its installer waiting on network checks with networking off; on a connected PC, or one that already has .NET 8 Desktop, it should be much shorter. Not measured.

### 11. Release notes
`docs\releases\RELEASE_NOTES_v1.3.0.md`: what was broken (split memory; config and keys lost; VS Bridge open to web pages; VS 2022 only; the smaller ones), what's fixed, that v1.2.x memory is still read from both folders, what to do after installing (quit and reopen Claude Desktop; reopen VS), how to report a problem (issues, which logs, check them for private data first).

---

## Not done, and why

- **The VS Bridge install against a real Visual Studio** was not run by the installer (it can't run on this PC, and the sandbox has no VS). `-ListOnly` shows the right targets. Dan's install of v1.3.0 is the first real run; `install.log` will show each instance's exit code.
- **VS 2026** is accepted by the manifest now but not tested.
- **`release.yml` has never run on GitHub** (decision 16).
- **`workbench.js` VS Bridge folder** (§7 item 17, new): it probes `OneDrive\Documents` then `Documents` instead of asking Windows. Outside P2's file list; the fix is small (use the same `MyDocuments` lookup as `index.js`). For P3.
- **Small things found** (§7 item 18, new): wrong repo name in Dashboard/tray app links; Dashboard registry value names; Node 22.14.0 bundled; finish-page "Start now" runs the tray app elevated. The Windows App Runtime check (`HKLM\SOFTWARE\Microsoft\WindowsAppRuntime\1.8`) never matches, so its installer runs on every install (10 s, harmless).
- **`CONTRIBUTING.md`** still shows the old folder tree (`Installer.wxs`, `Bundled/`). It isn't built or shipped; worth a rewrite with the README's plain style later.
- **The `.bak_*` files** from P1 and P2 stay beside the edited files, untracked (now gitignored).
