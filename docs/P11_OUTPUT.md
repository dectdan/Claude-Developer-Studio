# P11 Output: text that shows correctly everywhere, one label in the installer log, no build paths in the binaries; the v1.7.1 build
*2026-11-12, Claude Code (Opus 5.5), unattended (delegated). Prompt: `docs\P11_prompt.md`. Nothing was deployed, tagged or released; the version is **1.7.1**.*

## What the producer must do

1. **Review** this file and the diff (commit "P11: text shows correctly everywhere, one label in the installer log, no build paths in binaries, v1.7.1 build").
2. **Publish v1.7.1** with the EXE this run built and the sandbox tested: `Installer\Output\ClaudeDevStudio-Setup.exe`, 209,328,354 bytes (199.6 MB), SHA-256 **`2B29C7B970BB57D681C4EB27B581F63B4F690188FB4522796ECD2970093E79EC`** (= sandbox run `20261112-164211`, 91/91); notes **`docs\releases\RELEASE_NOTES_v1.7.1.md`**.
3. **Install it on Dan's PC** with the installer (the tray app, the Dashboard and the CLI all changed; `deploy.ps1` would bring only the CLI and the servers). Then tray › Memory backups › **Export memory…** once: the message should read "OK: Exported the memory store: … / n files, x MB -> y MB zipped". `%LOCALAPPDATA%\ClaudeDevStudio\install.log`'s new lines: "…  OK: Backup of the memory store before the upgrade: …" and one "Claude Code …" line. Quit and reopen Claude Desktop.
4. **Machine 3** (Windows 10, where the "û" was seen): upgrade silently as before and look at the new `install.log` lines (the run there had no console for the CLI; that case is now covered by a smoke check and by the code, see item 1).

## Results at a glance

| What | Result |
|---|---|
| Builds | 0 errors. Warnings: CLI **24**, TrayApp **14**, Dashboard **0** (`dotnet build -c Release -r win-x64 --no-incremental`), VSIX **12** (VS MSBuild, Rebuild); NSIS OK. All unchanged. |
| `tools\check-versions.ps1` | all 15 places say **1.7.1** |
| Smoke `--cli` (source, built CLI, isolated) | **211/211** (P10's 201 + 10 `P11:` checks), 68 s |
| Smoke, the installed v1.7.0 copy (isolated) | **200/200**; skipped and named: `run-phase.ps1` (not in an installed copy), the P11 group (needs a 1.7.1 CLI) |
| `claude-code-setup-test.js` / `config-merge-test.js` | 25/25 / 38/38 |
| Build-path check (`tools\check-build-paths.mjs`, now a step of `build-setup.ps1`) | v1.7.0's staging: **5 hits** (4 DLLs + the Dashboard PDB); v1.7.1's: **0 hits in 4,101 files**, 0 `.pdb` |
| Installer | 199.6 MB, SHA-256 `2B29C7B970BB57D681C4EB27B581F63B4F690188FB4522796ECD2970093E79EC` |
| Sandbox offline A–F + M | **91/91** (run `20261112-164211`, 20.5 min, foreground); in-sandbox SHA-256 = the host's. The run before it (`20261112-161747`, same EXE) was 90/91: one kit filter I had not updated (section 6) |
| The tray app's Export message, through its own code | before (v1.7.0's code + CLI): `âœ“ Exported the memory store … 0 KB â†’ 1 KB`; after: `OK: Exported the memory store: …\Zoë José 日本\export.zip … 0 KB -> 1 KB` (section 1) |
| Dan's store | not written by this phase's tests (section 7) |
| No bypass flag; no PC-specific paths in shipped files | checked: the build-path scan covers every staged file, and the source edits name no path of this PC |

## Decisions I made

1. **Both ends, and the writer first.** The cause was two-sided: the tray app read the CLI's UTF-8 as Windows-1252 (Dan's `âœ"`), and the CLI itself did not always write UTF-8: `Console.OutputEncoding = UTF8` calls `SetConsoleOutputCP`, which fails when the process has no console; the exception was swallowed and .NET fell back to a legacy code page. Reproduced here: started with no console, v1.7.0's CLI wrote `3f` ("?") for ✓ (ANSI 1252); with an OEM 437 fallback, as on machine 3, ✓ best-fits to `√` = byte `FB`, which NSIS shows as **"û"**. So: **the CLI now sets its streams itself** (`SetUpOutput` in `Program.cs`): to a pipe or file, a UTF-8 `StreamWriter` (no BOM) on the raw handle, console or not; to a console window, `Encoding.Unicode`, which makes .NET write with `WriteConsoleW` (any character shows in any console and the console's code page is no longer changed; checked by reading a hidden console's screen buffer: `OK José ✓ → 日本` on screen, `chcp` 437 before and after). **Every reader names UTF-8** (below).
2. **The CLI's own marks are ASCII: `OK:`, `WARNING:`, `ERROR:`, `Not added:`, `->`, `-` (and `+`/`-`/`^`/`v` in curator lists).** Why, when a modern terminal shows ✓ fine: some readers can't be told the encoding. Windows PowerShell 5.1 decodes a captured native command (`$x = claudedev …`, `| Select-String`) in the OEM code page; Windows 10's console font has no ✓ or ⚠ glyph; NSIS reads ANSI. ASCII is the only text that is right in all of them, and the marks carry nothing the words don't. The user's own text (names, paths, mistakes) keeps its characters and is right wherever the reader names UTF-8. Not changed: the `·` in `session_handoff.md`'s "*Written … · HND001*" line (a file format read by `cds-context.js` and `HandoffMerge`, not console output), the BOM trims, comments. No reader parsed the marks (index.js and the hook use exit codes; checked by search); the one smoke check that looked for ✓ accepts either.
3. **The installer no longer reads any program's text into `install.log`** (nsExec decodes in the ANSI code page, can't be told otherwise, and its "Unicode detection" only knows UTF-16): the CLI's pre-upgrade backup got **`--log <file>`** (appends its lines, each after the local time, UTF-8, the format `cds-config.js` and `cds-claude-code.js` already use), and **`cds-claude-code.js detect --log`** writes its one line itself. NSIS's own lines (`STEP`) are now written as **UTF-8** too (`LogUtf8`: `WideCharToMultiByte(CP_UTF8)` and `WriteFile` on `FileOpen`'s handle; `FileWrite` writes the ANSI code page), so the log is UTF-8 from end to end, also for a user folder such as `C:\Users\José` (tested with a probe installer: `[setup] José Zoë 日本 ✓ -> C:\Users\…` came out as valid UTF-8 after a Node-written line).
4. **The doubled label** came from the installer putting "Claude Code: " in front of detect's line, which already starts with "Claude Code". Fixed by item 3 (the installer no longer logs that line); detect's text is unchanged.
5. **Two more readers found by the search, fixed:** Node reading **Windows PowerShell** (5.1 writes to a pipe in the OEM code page): `cds-paths.js`'s Documents lookup returned `…\Zo\uFFFD Jos\uFFFD ??` for a folder named `Zoë José 日本`, so a user with such a name would have fallen back to a guessed Documents path. Every PowerShell `-Command` whose output CDS reads now starts with `PS_UTF8` (`[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false; `): `cds-paths.js`, all of `cds-phase.js`'s (in its `run`), the smoke test's and the merge script's lookups. And **`where.exe claude`** (`cds-phase.js`, `cds-claude-code.js`): its output came back garbled the same way, so Claude Code in such a folder wasn't found; replaced by **`findOnPath`** (PATH × PATHEXT, in Node; the same function in both files, since `cds-claude-code.js` is CommonJS staged on its own).
6. **Readers fixed:** the tray app (`CliStartInfo()`: the four places it runs the CLI: backups/export/import, Claude Code status, Link Claude Desktop, Claude Code setup/remove), the Dashboard's Backups page, the CLI reading Node (`configure-claude`, `claude-code`). Already right: the Dashboard's Phases page, `cds-context.js` `runCli`, `cds-phase.js` `run` (`encoding: 'utf8'`), `cds-hook.js` (through `runCli`), the sandbox kit (`StandardOutputEncoding = UTF8`). Left as is: `BuildAutomation.cs` reading `dotnet build` (not a CDS program; with the CLI no longer changing the console's code page, .NET's default, the console's code page, is what `dotnet` writes in).
7. **The tray app reads `CDS_CLI_PATH`** (tests only, like `index.js`'s), so its own `RunCli` could be driven against the new CLI without clicking (section 1).
8. **Build paths:** `ContinuousIntegrationBuild`, `Deterministic` and `PathMap=<repo>\=/_/` for Release in `Directory.Build.props` (`PathMap` because the VS Bridge's older-style project gets no mapping from the SDK; the SDK adds its own mapping of the same folder for the others). **`.pdb` files are not staged:** stack traces still name the methods; nothing in CDS reads line numbers; the installer is 0.1 MB smaller; and the Dashboard's PDB held the build user's NuGet cache path. `tools\check-build-paths.mjs` (new; reads only) is a step of `build-setup.ps1` before NSIS, so a later build that brings a path back fails.
9. **No mistake or activity was written to Dan's store** (read only for this phase), not even the one mistake below (section 6); it is a lesson candidate for the producer.

## 1. Every place a CDS program reads another's output

| Reader → writer | Before | After |
|---|---|---|
| Tray app → CLI (backup, export, import, `claude-code status/setup/remove`, `configure-claude`) | no encoding named: Windows-1252 | UTF-8 (`CliStartInfo`) |
| Dashboard Backups page → CLI | none: ANSI | UTF-8 |
| Dashboard Phases page → `node cds-phase.js` | UTF-8 | unchanged |
| CLI → `node cds-config.js` / `cds-claude-code.js` | the console's code page (UTF-8 only while the setter worked) | UTF-8 |
| `index.js`, `cds-hook.js` → CLI (`runCli`) | UTF-8 | unchanged; the CLI now always writes it |
| `cds-paths.js`, `cds-phase.js`, smoke, merge script → PowerShell | UTF-8 assumed, OEM written | `PS_UTF8` first |
| `cds-phase.js`, `cds-claude-code.js` → `where.exe` | OEM written | not read: `findOnPath` |
| Installer (nsExec) → CLI `backup --upgrade`, `cds-claude-code.js detect` | ANSI, logged with FileWrite (ANSI) | not read: each writes its own lines (`--log`, UTF-8) |
| Installer's own `install.log` lines | ANSI (`FileWrite`) | UTF-8 (`LogUtf8`) |
| Installer (nsExec `ExecToLog`) → Node/PowerShell scripts (details window only) | ANSI | unchanged: those scripts print ASCII (checked), and log their own lines in UTF-8 |
| Sandbox kit → CLI / install.log | UTF-8 / `Get-Content` (ANSI) | UTF-8 / `Get-Content -Encoding UTF8` |

**The CLI's bytes, one command three ways** (`init`, throwaway root): v1.7.0, hidden console `e2 9c 93 20 49 6e …` ("✓ Init…"), **no console `3f 20 49 6e …` ("? Init…")**; v1.7.1, both `4f 4b 3a 20 49 6e …` ("OK: Init…"), and a non-ASCII path in the output is exact both ways (smoke).

**The tray's Export message, from its own code path** (a scratch WinExe, no console like the tray, loading the built `ClaudeDevStudio.TrayApp.dll` and calling `TrayApplication.RunCli(["export", file])` by reflection; throwaway root):
- v1.7.0's tray code and CLI (the installed copy, read only): `âœ“ Exported the memory store: …\tray-before.zip` / `  1 files, 0 KB â†’ 1 KB zipped, 0.1 s` (Dan's text).
- v1.7.1's tray code, v1.7.0's CLI (the reader fix alone): `✓ Exported the memory store: …` / `0 KB → 1 KB`.
- v1.7.1's tray code and CLI: `OK: Exported the memory store: C:\Users\…\cds_p11_scratch\Zoë José 日本\export.zip` / `  1 files, 0 KB -> 1 KB zipped, 0.1 s`.

**`install.log`, machine 3 / the sandbox before → after:**
- `[setup] Memory backup (exit 0): û Backup of …` (machine 3) and `[setup] Memory backup (exit 0): âœ“ Backup …` read as ANSI (the sandbox's bytes were UTF-8 passed through, so only a UTF-8 reader showed them right) →
  `2026-11-12T16:55:44  OK: Backup of the memory store before the upgrade: C:\Users\WDAGUtilityAccount\Documents\ClaudeDevStudio\Backups\store\ClaudeDevStudio-store-…-upgrade.zip` / `2026-11-12T16:55:44    5 files, 2 KB -> 3 KB zipped, 0.1 s` / `[setup] Memory backup (exit 0); its lines are above.`
- `[setup] Claude Code: Claude Code: not found. To use it, …` (followed by an empty line) → `2026-11-12T16:53:11  Claude Code: not found. To use it, install it: …`; with Claude Code there: `…  Claude Code 26.13.1 found at C:\Users\WDAGUtilityAccount\.local\bin\claude.exe.`
- Every install/uninstall log of the passing run (A, B, D, E, F, F1, C, E/F uninstall): valid UTF-8, 0 non-ASCII bytes, no `û`/`â`/`Ã`/U+FFFD, no doubled label.

## 2. The installer log's doubled label

See Decision 4 and the lines above. Sandbox A checks it ("install.log: the Claude Code line has one label"), and the whole-log check in B fails on "Claude Code: Claude Code:" anywhere.

## 3. Build paths

- **Before** (v1.7.0's `Installer\build`, `node tools\check-build-paths.mjs`): `CLI\claudedev.dll`, `TrayApp\ClaudeDevStudio.TrayApp.dll`, `Dashboard\ClaudeDevStudio.Dashboard.dll`, `VSExtension\CdsVsBridge.vsix!CdsVsBridge.dll`: the repository folder (e.g. `RSDS…D:\Projects\ClaudeDevStudio\obj\Release\net8.0\win-x64\claudedev.pdb`); `Dashboard\ClaudeDevStudio.Dashboard.pdb`: the user name (the NuGet cache); 3 `.pdb` staged.
- **After** (v1.7.1's): "Scanned 4101 files (248.8 MB) … .pdb files: 0 … No build-machine path in any file." Looked for the repository folder and the user folder (with `\` and `/`), the user name and the PC name, as UTF-8 and UTF-16LE, any case, inside the VSIX too. The DLLs' PDB paths now: `/_/obj/Release/net8.0/win-x64/claudedev.pdb`, `/_/ClaudeDevStudio.UI/obj/…/ClaudeDevStudio.TrayApp.pdb`, `/_/ClaudeDevStudio.Dashboard/obj/…/ClaudeDevStudio.Dashboard.pdb`, `/_/VSExtension/CdsVsBridge/obj/Release/CdsVsBridge.pdb`.
- `build-setup.ps1` prints "Not staged: 3 .pdb file(s) (claudedev.pdb, ClaudeDevStudio.TrayApp.pdb, ClaudeDevStudio.Dashboard.pdb)" and runs the scan before NSIS.

## 4. Version, notes, files

- **1.7.1** in `Directory.Build.props`, both `package.json`, `manifest.json`, `setup.nsi`, the VSIX manifest and `CdsVsBridgePackage.cs` (the rest follow); `check-versions.ps1`: all 15 places. `docs\releases\RELEASE_NOTES_v1.7.1.md`.
- **New:** `tools\check-build-paths.mjs`, `docs\releases\RELEASE_NOTES_v1.7.1.md`, this file. **Changed:** `Program.cs` (`SetUpOutput`, the marks, `backup --log`, the Node readers), `BuildAutomation.cs`, `ClaudeMemory.cs`, `ContextAutoLoader.cs`, `MemoryCurator.cs` (marks), `ClaudeDevStudio.UI\Program.cs`, `ClaudeDevStudio.Dashboard\Views\BackupsPage.xaml.cs`, `Installer\setup.nsi`, `Installer\cds-claude-code.js`, `Installer\build-setup.ps1`, `mcp-server\cds-paths.js`, `mcp-server\cds-phase.js`, `mcp-server\test\smoke.mjs`, `tools\sandbox-test\in-sandbox.ps1`, `tools\merge-memory-stores.mjs`, `Directory.Build.props`, the version files, `docs\GROUND_TRUTH.md`. Every edited tracked file has a `.bak_20261112_1603` copy (gitignored).

## 5. Tests

- **Smoke `--cli` 211/211.** The 10 `P11:` checks use a throwaway root under `%TEMP%\<scratch>_p11 Zoë José 日本` (so the user's own text is non-ASCII): export and `backup --all` **with a hidden console (as the tray starts it) and with no console at all (as machine 3's installer did)**, read as UTF-8: "OK: …", the path exact, the CLI's own words ASCII, no `â`/`Ã`/`û`/U+FFFD (4 checks); the same bytes read **the v1.7.0 tray's way (Windows-1252)**: "OK:" and "->" intact; `backup --upgrade --log`: timed lines, valid UTF-8, the path exact; `detect --no-claude --log`: one line, one label, exit 4; `findOnPath` finds `claude.cmd` in the non-ASCII folder; a `PS_UTF8` PowerShell returns the non-ASCII path exactly; nothing reached the real store.
- **Sandbox**, run `20261112-164211`, offline, A–F + M (`-HostExport`: made with the staged 1.7.1 CLI from a throwaway root with `M2MProj`, its handoff and mistake), in the foreground, 20.5 min; the VM was closed by the runner ("did not shut down by itself; closing it"); no `vmmemWindowsSandbox` left.

| Scenario | Checks | Result |
|---|---|---|
| A fresh install | 18 (+1: one Claude Code label) | PASS (in-sandbox smoke 210/210) |
| B upgrade | 11 (+1: the memory-backup lines read cleanly; the whole log valid UTF-8, no mojibake) | PASS |
| M machine to machine | 3 | PASS |
| C uninstall | 9 | PASS |
| D Documents redirected | 10 | PASS (in-sandbox smoke 210/210) |
| E Claude Code setup | 25 | PASS |
| F no Claude Desktop | 15 | PASS |
| **Total** | **91** | **91/91** |

(In-sandbox 210 vs the host's 211: no `tools\phase\run-phase.ps1` in an installed copy, skipped and named.)

## 6. A mistake in this phase

Changing detect's log line, I updated the kit's filter in scenario A but missed a second one in E (`'\[setup\] Claude Code:|Setting up Claude Code'`), so the first sandbox run (`20261112-161747`, the same EXE) was 90/91: "Claude Code found: a plain silent install sets it up" failed although the setup ran (its evidence lists the four hooks; E-install.log: "Claude Code 26.13.1 found at …"). Fixed the filter and reran everything (91/91). Lesson candidate: when a log line's format changes, search the test kit for every pattern that matches the old line (here `\[setup\] Claude Code`) before the 20-minute run. Not recorded in Dan's store (read only for this phase).

## 7. Dan's store

Files written under `C:\Users\…\OneDrive\Documents\ClaudeDevStudio` from 15:55 to the end of the tests: only `Projects\ClaudeDevStudio\Activity\2026-11-12.jsonl` and `Projects\ClaudeDevStudio\hook_state\<this session>\*` (this session's own Claude Code hooks: one `file_edit` line per edited file); no new project folder, no backup, nothing else. Every CLI run of the tests and probes had `CDS_MEMORY_ROOT` on a throwaway folder in `%TEMP%`. The installed copy was only read (its tray DLL loaded by reflection for the "before" message; its CLI run against a throwaway root).

## 8. Not done, and why

- **Machine 3 itself** wasn't used (another PC, not for an unattended phase); its no-console case is reproduced here and covered by two smoke checks.
- **The tray menu wasn't clicked** (unattended); its message text was produced by its own `RunCli` (section 1).
- **A Windows user with a non-ASCII name** wasn't created in the sandbox; the paths were tested with non-ASCII folders on the host (CLI output, install log writer, Documents lookup, PATH search). NSIS's own strings with such a path are written as UTF-8 by `LogUtf8` (probe), but a full install as such a user is untested.
- **`nsExec::ExecToLog`'s details window** still decodes as ANSI; the scripts it shows print ASCII only, and none of it goes into `install.log`.
- The CLI's messages in `BuildAutomation.cs`, `MemoryCurator.cs` and the like (legacy commands) got ASCII marks but no other review.
