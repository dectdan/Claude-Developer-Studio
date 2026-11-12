# P6 Output — Contact address, the debug monitor decision, the VS Debug pane, session state out of AppData, sandbox time limits, the v1.5.0 build
*2026-11-12, Claude Code (Opus 5.5), unattended. Prompt: `docs\P6_prompt.md`. Nothing was deployed, tagged or published. Dan's `~/.claude/settings.json`, `~/.claude.json`, `claude_desktop_config.json`, the installed copy in `%LOCALAPPDATA%\ClaudeDevStudio`, Dan's main Visual Studio and its extensions, any `qwen_config.json` and `D:\websites` were not touched. Dan's memory store: only the smoke test's throwaway projects (removed afterwards; as before the older checks add a few lines to the chat mirror) and what this session's hooks record. The VS Bridge's state folder (`[Documents]\ClaudeDevStudio\VSBridge\`), which the experimental instance writes to, was backed up before the test and put back after: byte-identical (7 files, MD5).*

---

## For the producer and Dan

1. **Review** this file, `docs\releases\RELEASE_NOTES_v1.5.0.md` and the commit (`P6: contact address, debug monitor decision, VS Debug pane, session state out of AppData, sandbox time limits, v1.5.0 build`).
2. **Publish v1.5.0** (the producer): tag `v1.5.0` at the P6 commit; attach `Installer\Output\ClaudeDevStudio-Setup.exe`, **199.7 MB (209,362,184 bytes), SHA-256 `BD338FE200BFAA646230748D1084B46E8ABB03BAB92164D4A3FFA90276F1C127`** (the one the sandbox ran, below); the notes are `docs\releases\RELEASE_NOTES_v1.5.0.md`. Check the uploaded asset's digest equals that SHA-256.
3. **Dan's PC:**
   - **Install v1.5.0** (it upgrades 1.4.0 + the P5 deploy; keys, other servers, PATH and the Claude Code setup are kept as before). Then quit Claude Desktop fully and reopen it; start a new Claude Code session.
   - **Close and reopen Visual Studio** so the new VS Bridge (1.5.0) loads. To check it: ask Claude for `claudedev_vs_get_output` with `pane: "list"` (an old bridge answers "older than 1.5.0"), or look for `"extension_loaded","extra":{"version":"1.5.0"}` in `Documents\ClaudeDevStudio\VSBridge\vs_events.jsonl`. In the experimental instance an in-place upgrade once kept loading the removed folder (GROUND_TRUTH §7 item 22); Dan's VS gets the VSIX per machine through the installer, a different path, but if the list call says "older" after a restart of VS, that is why: tell the producer.
   - **The moved session state:** nothing to do. The CLI's `switch`/`active` state now lives in `Documents\ClaudeDevStudio\cli_session_state.json`; the first `claudedev switch`/`active`/`projects` after the upgrade copies `%APPDATA%\ClaudeDevStudio\session_state.json` (Dan's is from 2026-11-10) there once. The old file and the virtualized copy in Claude's package folder stay; both can be deleted by hand any time, nothing reads them after the copy.
4. **The old address** remains in git history and in the published v1.0–v1.4 installers and binaries (a fact, not a task; history was not rewritten). In the tree it is left only in records of the past: `docs\history\` (7 hits in 3 files: `CRITICAL_UX_ISSUES.md` 5, `MAINTENANCE.md` 1, `website-updated.html` 1), `docs\releases\RELEASE_NOTES_v1.0.0.md` (1) and `docs\P6_prompt.md` (1, the prompt quoting it). The website (`D:\websites\claudedevstudio.com`, phase W) still has it in its footer.

---

## Results at a glance

| What | Result |
|---|---|
| Contact address | `support@gainpublications.com` in the CLI's help and version, the tray app's About box, the Dashboard's About and Help, `LICENSE` (Dan's name kept as author and copyright holder), README, CONTRIBUTING, and the uninstall entry (`Contact`, `HelpLink`). Staged binaries scanned: `claudedev.dll`, `ClaudeDevStudio.TrayApp.dll`, the Dashboard's `.pri` carry only the new address |
| Debug monitor | **Removed** (evidence below). `tools/list` **6,685 → 6,341 bytes**, 14 → 13 tools; instructions unchanged (825 characters; they never named it) |
| `claudedev_vs_get_output` | `pane`: `build` (default, as before), `debug`, a pane name or GUID, `list`. **Tested in VS 2022's experimental instance** with a program under the debugger: its `Debug.WriteLine`/`Trace.WriteLine` lines come back live. Workbench `tools/list` 4,131 → 4,315 bytes |
| Session state | `[Documents]\ClaudeDevStudio\cli_session_state.json`; the old `%APPDATA%` file copied once, never changed or deleted |
| Sandbox kit | Per-step time limits, a watchdog, scenario T, the runner refuses to start while a sandbox VM runs |
| Automatic handoff (P5) | Written: HND001, 2026-11-11 20:24, source auto, "from the Claude Code session (session end)"; no `hooks.log` |
| Version | **1.5.0**, `check-versions.ps1`: all 15 places |
| Builds | 0 errors. CLI **33** warnings (was 42), TrayApp **14** (was 23): the 9 fewer in each are the removed `VSDebugMonitor.cs`'s own (nullable warnings); no new warning. Dashboard 0, VSIX 12 (unchanged). NSIS: 0 warnings |
| Smoke | `--cli bin\Release\net8.0\claudedev.exe` **107/107** (P5's 86 + 21); installed CLI **70/70** (skips named) |
| Installer | 199.7 MB, SHA-256 `BD338FE200BFAA646230748D1084B46E8ABB03BAB92164D4A3FFA90276F1C127` |
| Sandbox | Offline **T + A–F 79/79** (T 4, A 16, B 9, C 9, D 10, E 16, F 15), the SHA-256 above; networked T + A + F **36/37**: Claude Desktop's MSIX downloads (6 s), installs and **starts** after CDS, uses the real config file and keeps both CDS entries; the one FAIL is "Claude Desktop started CDS's servers" (0 in 75 s, unsigned: see section 7) |

---

## Decisions I made

1. **The monitor is dropped, not kept** (item 2; the evidence is under "The debug monitor"). The CLI command stays as one line: `claudedev monitor` prints "claudedev monitor was removed in ClaudeDevStudio 1.5.0. For a running program's Debug.WriteLine/trace output, ask Claude to use claudedev_vs_get_output with pane "debug" (Visual Studio with the CDS VS Bridge)." and exits 1, so a script or habit that calls it learns why. The MCP server no longer lists the tool, but a call to it (an old chat that still has the tool in context) gets a one-line error naming the replacement instead of "Unknown tool".
2. **Where the monitor was mentioned:** the tray app's About box and the Dashboard's About page listed "Debug output monitoring (DebugView integration)" as a feature: replaced by "Visual Studio bridge (build errors, output, debugger)". The Dashboard's Help page listed `claudedev monitor` (row removed) and said the tray app runs "monitoring debug output" (now: what it does). The Dashboard's Settings page had a "Debug Monitoring" section (a DebugView status line and a checkbox that did nothing): removed, with its code in `SettingsPage.xaml.cs`. That is more than "text only" for the Dashboard, but it is the monitor's own UI, which item 2 asks to update. `mcp-server\manifest.json` (the old Claude Extensions manifest, not used since v1.2.0) loses the tool too. `setup.nsi`'s comment about a user-made DebugView folder stays (the uninstaller still leaves such a folder alone).
3. **The contact address in `LICENSE`:** both places become "Daniel E Gain (Gain Publications, support@gainpublications.com)" and "Daniel E Gain, Gain Publications / Email: support@gainpublications.com". Dan's name stays everywhere it is the author, copyright or licence holder (LICENSE, the About boxes, `PRODUCT_PUBLISHER`, the VSIX publisher "Dan Gain"). `package.json`, `manifest.json` and the VSIX manifest had names but no address: unchanged. **New:** the installer writes `Contact` and `HelpLink` (`mailto:`) into the uninstall entry, so Windows' Apps list shows the address; README and CONTRIBUTING name it next to the issues link.
4. **`pane: "build"` stays the saved file** (`vs_build_output.txt`, written when a build ends), exactly as before, so it still works with Visual Studio closed and with an older bridge. Every other pane is read live. A live Build pane is still reachable by its GUID (`{1BD8A850-02D1-11D1-BEE7-00A0C913D1F8}`).
5. **Finding a pane:** first the well-known GUIDs for `build`, `debug`, `general` (pane names are localized: a German Visual Studio's Debug pane is not called "Debug"), then the name in any case, then a GUID. `list` (or `panes`) names them, marks build/debug, and gives line counts.
6. **The size limit is the one the tool had:** the newest `lines` lines (default 100), no other cap. The bridge reads only those lines from the pane's buffer (`MoveToLineAndOffset`), not the whole pane. In the real test, 100 Debug-pane lines were 5,653 characters (module-load lines are long). A character cap would be new behaviour; not added.
7. **An older bridge is recognized:** `GET /pane` and `/panes` are new, so a 1.4.0 bridge answers 404, and the tool says the bridge is older than 1.5.0 instead of quietly returning the Build pane (the old `/output` ignores parameters).
8. **A pane Visual Studio hasn't written to yet** (found in the real test: its `TextDocument` fails with E_FAIL) answers "Visual Studio has not written anything to this pane yet." (for the Debug pane, plus where its output comes from), not an error; `list` shows such panes as "(no text yet)".
9. **`CDS_VS_BRIDGE_PORT`** (test-only, like `CDS_MEMORY_ROOT`): moves the port `workbench.js` talks to, so the smoke test runs a fake bridge on a spare port and never talks to a real Visual Studio.
10. **Session state goes to Documents, not `%LOCALAPPDATA%`:** Microsoft's rule for packaged apps (write virtualization) covers files newly created anywhere in the user's AppData folder, Local as well as Roaming, so `%LOCALAPPDATA%\ClaudeDevStudio\session_state.json` created by a CLI started from Claude Desktop would be redirected just the same; Documents is not virtualized (the memory has always been there). The file is `cli_session_state.json` at the memory root (`MemoryPaths.Root`, so `CDS_MEMORY_ROOT` moves it for tests), named so it isn't mistaken for the per-project `session_state.json`. The old path is taken from the `APPDATA` variable (the same folder in normal use; a test can point it elsewhere). Synced by OneDrive like the rest of the store: a second PC would see the same "active project" path, harmless (only `switch`/`active`/`projects`/`autoload` use it, never MCP).
11. **Sandbox time limits:** steps that are one PowerShell cmdlet that can hang (the MSIX download, `Add-AppxPackage`, starting Claude Desktop and looking at its processes, reading the event log) run through `Invoke-Step` in their own `powershell.exe`, killed at their limit, because a hung cmdlet can't be interrupted from inside the same PowerShell. The installer, uninstaller and every program run already had or now have limits (installer 1,800 s, uninstaller 600 s, programs 60–600 s). Behind all of them, a **watchdog** process shuts the sandbox down at `-TimeoutMinutes` − 4 (56 min by default; at least 10), so even a hang in an unwrapped step ends the VM before the host gives up. results.json is saved after every check, so a watchdog stop keeps what ran. Scenario C now uses `Run-Uninstaller` (it had its own copy of the same loop).
12. **Scenario T** (new, not in the default list): a step that sleeps 120 s with an 8 s limit is stopped and the script goes on; a quick step returns its result; a dry-run watchdog (5 s, writes a marker instead of shutting down) fires; the real watchdog is running. I ran it with A–F.
13. **The runner refuses to start** while `vmmemWindowsSandbox` (the sandbox's VM) runs, as well as while the sandbox's window processes run, and says how to close it (open Windows Sandbox from the Start menu and close its window, or restart Windows). After its own timeout it waits up to 2 minutes for the watchdog's shutdown, then reports whether the VM is still there.
14. **The experimental instance was reset twice** (`CreateExpInstance /Reset`, which only recreates `%LOCALAPPDATA%\Microsoft\VisualStudio\17.0_c7705ad0Exp` and copies the main instance's per-user extensions into it read-only). It had a CDS VS Bridge 1.0.0 from March, and after the in-place upgrade Visual Studio kept loading the removed folder (GROUND_TRUTH §7 item 22). The experimental instance is a test hive; nothing of Dan's main instance changed.
15. **No explicit handoff from this session** (`claudedev_handoff` writes to Dan's memory store, which this prompt keeps out of bounds apart from what the hooks record): the SessionEnd hook will write the automatic one.
16. **Networked F: run.** The prompt allowed it only if the time limits made it safe; they do. Each networked step has a limit, the watchdog shuts the VM down at 56 minutes, and the runner refuses a second run while a VM is left over. It ran after the offline run passed, with T in front so the limits were checked in that run too. It finished in 14 minutes with nothing stopped. Its one failure is reported as it is (section 7); I didn't change that check after seeing the result.

---

## 1. The contact address

Searched with `git grep -i` for the old address and `gmail.com` over tracked and untracked files (excluding `node_modules`, `bin`, `obj`, `.git`, `qwen_config.json` and the gitignored `.bak_*` backups), before and after. Before: 18 hits in 10 files. Changed: `Program.cs` (`ShowHelp`, `ShowVersion`: "Contact: support@gainpublications.com"), `ClaudeDevStudio.UI\Program.cs` (About box), `ClaudeDevStudio.Dashboard\Views\AboutPage.xaml` (Contact link and `mailto:`), `HelpPage.xaml` ("Need Help?" link), `LICENSE` (2), plus the new lines in `README.md`, `CONTRIBUTING.md`, `setup.nsi` (`PRODUCT_CONTACT`, uninstall entry). After: hits only in `docs\history\` (7 in 3 files), `docs\releases\RELEASE_NOTES_v1.0.0.md` (1) and `docs\P6_prompt.md` (1). The built and staged binaries (`Installer\build\CLI\claudedev.dll`, `TrayApp\ClaudeDevStudio.TrayApp.dll`, `Dashboard\ClaudeDevStudio.Dashboard.pri`, scanned as UTF-16 at both byte alignments and as UTF-8) contain the new address and not the old one. No PC-specific path in any tracked file outside `docs\` (`git grep` for the user folder name and `D:\Projects`: none).

Also noticed, not changed: the Dashboard's About page shows a fixed "v1.0.0" (it should read the assembly version; a code change, outside "text only").

## 2. The debug monitor: dropped

**What it did:** `claudedev monitor <project>` started Sysinternals DebugView (`dbgview64.exe /l <temp log> /t /n`), tailed its log, and recorded any line that looked like an exception (`Exception` anywhere in the line, or `at ... in ...:line N`) as an `exception` activity in the project's memory; `claudedev_monitor_start` started that detached.

**What it gave that the bridge doesn't:** output from programs *not* running under a debugger (DebugView listens to `OutputDebugString` system-wide). That is also its flaw: a program debugged in Visual Studio sends its debug output to the debugger, not to DebugView, so the "VS Debug Monitor" never saw the very programs its name promised; and it recorded matching lines from *every* process on the PC into whichever project it was started for.

**How often it was used:** the chat mirrors (both stores, read-only, 752 + 1,082 lines) hold **one** `claudedev_monitor_start` call (2026-09-16, under v1.2.x, whose CLI call ran under a 30-second timeout that killed it). Neither store has a single activity the monitor would have written (`exc_…` IDs or `action: exception`). `claudedev_search` for "DebugView" finds nothing, "debug monitor" only its building in February 2026. (The mirror keeps only 24 hours of tool lines once it passes 2,000 lines, so older calls may be missing; there is still no trace of anything it recorded.)

**What it cost:** a tool definition in every session (344 bytes of `tools/list`); for users, finding, downloading and placing DebugView (CDS may not ship it, §7 item 3), with the Dashboard showing "DebugView: Not found" to everyone who didn't.

**Done:** `claudedev_monitor_start` removed from `index.js` (with `handleMonitorStart` and the now unused `spawn` import), `VSDebugMonitor.cs` removed (`git rm`; it is in history, and in `VSDebugMonitor.cs.bak_20261111_1313`), its line in `ClaudeDevStudio.TrayApp.csproj` removed, `claudedev monitor` prints one line (decision 1), help text and the Program.cs header without it, `mcp-server\README.md` (13 tools, a note on the removal) and `manifest.json`, the tray and Dashboard text (decision 2). `tools/list`: **14 tools, 6,685 bytes → 13 tools, 6,341 bytes** (`show.mjs --tools`; the installed P5 copy still says 14/6,685).

## 3. `claudedev_vs_get_output`: the Debug pane

**How the bridge read the Build pane:** on `OnBuildDone` it walks `DTE.ToolWindows.OutputWindow.OutputWindowPanes`, takes the pane named "Build", reads `TextDocument` from `StartPoint` to `EndPoint` and writes it to `vs_build_output.txt`, which the tool reads. **New in the bridge** (`VsBridgeServer.cs`): `GET /panes` and `GET /pane?name=&lines=`, on the UI thread like the other DTE calls; the same `OutputWindowPane.TextDocument`, reading from `last − lines + 1` to the end; the well-known GUIDs from `VSConstants.OutputWindowPaneGuid` (`BuildOutputPane_guid`, `DebugPane_guid`, `GeneralPane_guid`). **In the workbench** (`workbench.js`): the `pane` parameter (decisions 4–9). Description: "Get a VS Output pane: build (default), debug (a running program's Debug.WriteLine/trace output), any pane by name, or list."

**The real test, in Visual Studio Community 2022 (17.14) experimental instance** (`devenv /rootSuffix Exp`; the VSIX installed with `VSIXInstaller /quiet /rootSuffix:Exp /instanceIds:c7705ad0`; Dan's main instance was not running and was never started). A throwaway console app in `%TEMP%\cds_p6_dbgapp` (`Debug.WriteLine($"CDS-P6 Debug.WriteLine line {i}")` every 0.5 s, `Trace.WriteLine` every 10th) was opened in the experimental instance; a scratch script started it under the debugger through the bridge (`POST /command {"action":"debugger.go"}`), waited, and called `claudedev_vs_get_output` through `workbench.js` over MCP stdio, as Claude would. Output, shortened:

```
== pane "debug" before debugging:
Output pane "Debug": Visual Studio has not written anything to this pane yet. A program started under the debugger writes its Debug.WriteLine/trace output here.
== start debugging (debugger.go): 200 {"ok":true}      state: "debugMode": "run"
== pane "list":
Output panes (11); pass a name as pane:
  Source Control - Team Foundation  (no text yet)
  Build  [pane: "build"]  1 line
  ...
  Debug  [pane: "debug"]  49 lines
  Package Manager  5 lines
  GitHub Copilot  80 lines
  ...
== pane "debug", lines 8:
Output pane "Debug" (last 8 of 48 lines, live):
CDS-P6 Trace.WriteLine at 20
CDS-P6 Debug.WriteLine line 21
...
CDS-P6 Debug.WriteLine line 27
== pane "debug" (default 100 lines): 5653 characters; "Output pane "Debug" (all 56 lines, live)", module loads first, then the Debug.WriteLine lines up to 34
== pane "Debug" by its name, lines 3: (last 3 of 56 lines, live) lines 32-34
== pane "{FC076020-078A-11D1-A7DF-00A0C9110051}" by GUID, lines 2: lines 33-34
== pane "no such pane": [VS Bridge] There is no Output pane named "no such pane". Output panes now: "Source Control - Team Foundation", "Build" (build), ..., "Debug" (debug), ...
== pane "build" (the saved copy, as before): Build Output (last 3 lines): ... CdsP6DebugApp -> ...\bin\Debug\net8.0\CdsP6DebugApp.dll
== stop debugging: 200 {"ok":true}
```

(The "1 line" above is from the final run, after a plural fix in the list text.) `caller-check.mjs http://localhost:62000` against the same bridge: **5/5** (no CORS header, `Origin` refused 403, foreign Host refused 400 by HTTP.sys, `POST /command` with `Origin` 403). The first run of the test found the E_FAIL on a never-written pane (decision 8); fixed, rebuilt, reinstalled and rerun as above. Then the experimental instance was closed through its main window, the test app's process was gone, and the VSBridge folder was put back (byte-identical).

**Where it got stuck, and how it got on:** (1) the old CDS VS Bridge 1.0.0 in the experimental hive: after `VSIXInstaller` replaced it, Visual Studio kept loading the removed folder (ActivityLog: "CreateInstance failed for package [CdsVsBridgePackage] ... Could not load file or assembly ...\Dan Gain\CDS VS Bridge\1.0.0\CdsVsBridge.dll"); `devenv /updateconfiguration` didn't help; `CreateExpInstance /Reset` and a fresh install did. The same happened after reinstalling 1.5.0 over 1.5.0, and was fixed the same way (GROUND_TRUTH §7 item 22). (2) A fresh hive's first start shows the start window and ignores the solution: started once, closed, started again. (3) `/log` before the solution took the solution's path as the log file and overwrote the throwaway `.sln` (recreated; GROUND_TRUTH §11). (4) My first probes used `http://127.0.0.1:62000`, which HTTP.sys answers 400 (the registration is `localhost`); the workbench uses `localhost` and was fine (§11). No window needed a click.

**The smoke test** checks the tool without Visual Studio (decision 9): the schema has `pane`; no pane is the saved Build pane (none yet: says so; 150 lines saved: `lines: 5` gives 146–150); `debug` and `list` with nothing on the port fail politely ("Visual Studio with the CDS VS Bridge isn't reachable on localhost:<port> (nothing is listening). Open Visual Studio with a solution and try again. ..."), as the other VS tools do (plain text, not an exception); against a fake bridge: `debug` asks for `/pane?name=debug&lines=100` and shows "last 100 of 300 lines"; `list`; a name with spaces passed encoded with `lines`; an unknown pane lists the panes; a never-written pane; a bridge answering 404 is "older than 1.5.0", and nothing of the Build pane is shown instead.

## 4. Small fixes found in P5

**`SessionStateManager.cs`** (decision 10): the constructor uses `MemoryPaths.Root\cli_session_state.json`; if it doesn't exist and `%APPDATA%\ClaudeDevStudio\session_state.json` does, it copies it (`overwrite: false`); a failure there starts with an empty state. Checked by the smoke test with a throwaway `CDS_MEMORY_ROOT` and `APPDATA`: no files → "No active project set." and no file created; an old file → `active` shows it (name, session count), the new file is a byte copy, the old one unchanged; the old file changed afterwards → still the copied state (read once); the real `%APPDATA%` file and the real memory root unchanged (size and time).

**Everything else that writes under `%APPDATA%`** (searched: `SpecialFolder.ApplicationData`, `APPDATA`, `Roaming` in all source outside `docs\`, `node_modules`, `bin`, `obj`):

| Where | What | Runs under Claude Desktop? | Verdict |
|---|---|---|---|
| `Program.cs` `ConfigureClaude`, `Installer\cds-config.js`, `setup.nsi` | `%APPDATA%\Claude\claude_desktop_config.json` | `configure-claude` from the tray app or a terminal | Meant to (Claude Desktop's own config) |
| `SessionStateManager.cs` | `%APPDATA%\ClaudeDevStudio\session_state.json` | the CLI, yes | **Moved** (above) |
| `ApprovalSystem.cs` (root) | creates `%APPDATA%\ClaudeDevStudio\approvals\` in its static constructor | never: nothing in the CLI calls it (the Dashboard has its own `ApprovalSystem` class) | Unused; left |
| `BackupManager.cs` | `%APPDATA%\ClaudeDevStudio\Backups\<project>` for `BackupStrategy.Local` | only if a user chooses that strategy (the default is Documents) | Left; reported |
| Dashboard `ConfigurationWizard.xaml.cs` | `%APPDATA%\ClaudeDevStudio\settings.json` | no (the Dashboard runs on its own) | Not virtualized; left |
| Dashboard `App.xaml.cs` | `%APPDATA%\ClaudeDevStudio\Logs\errors_<date>.log` | no | Left |
| Dashboard `SettingsPage.xaml.cs` | reads Claude's config | — | Read only |

On Dan's PC, `%APPDATA%\ClaudeDevStudio` holds only `session_state.json` (355 bytes, 2026-11-10).

**The sandbox kit's time limits:** decisions 11–13; results below.

**The automatic handoff in a real session (report only, read-only):** P5's SessionEnd hook **did** write one. `ClaudeDevStudio\HANDOFFS.jsonl` has one entry, **HND001**, 2026-11-11 20:24:56, `source: auto`, origin "from the Claude Code session (session end)", and `session_handoff.md` (2,090 bytes, first line `<!-- cds-handoff: auto -->`) shows it. Shortened: *Where I stopped:* "Claude Code session, when the session ended (other). The last request: "Read docs\P5_prompt.md and carry it out. ..."" *Next step:* "Not stated (an automatic handoff): pick up from the last request and reply above, or the ground truth's Next." *Notes:* "Files edited in this session (28): ..." (22 project files and 6 scratch scripts in `%TEMP%`), "Claude's last reply: "P5 is finished and pushed as `4a982bc` ..."", "Resume that session with: claude --resume 60fb5b5b-...". `%LOCALAPPDATA%\ClaudeDevStudio\hooks.log` does not exist: no hook error. This session's SessionStart hook showed that handoff first, so the loop works end to end (session end → handoff → next session's start). One small thing: the file list includes files outside the project, which post-tool-use's activity lines skip (GROUND_TRUTH §7 item 23).

## 5. Version 1.5.0 and the build

`Directory.Build.props` 1.5.0; `mcp-server\package.json`, `manifest.json`, `review-server\package.json`, `setup.nsi`, the VSIX manifest and `CdsVsBridgePackage.cs`'s logged version follow; `tools\check-versions.ps1`: **all 15 places say 1.5.0** (including the built CLI's `claudedev version`). `docs\releases\RELEASE_NOTES_v1.5.0.md` written in v1.4.0's style (P5 and P6; "Known": the first install's time, ~10 minutes in Windows Sandbox, about a minute on machine 3).

`Installer\build-setup.ps1`: BUILD COMPLETE in 2.7 min, **209,362,184 bytes (199.7 MB), SHA-256 `BD338FE200BFAA646230748D1084B46E8ABB03BAB92164D4A3FFA90276F1C127`**, NSIS OK. Warnings, each project built on its own (`--no-incremental`): CLI 33 (BuildAutomation 12, AutoStartManager 9, CloudSyncManager 4, Program 3, UpdateChecker 3, GitSyncManager 2; none in the changed files), TrayApp 14, Dashboard 0, VSIX 12 (the same twelve as before: CS0169, VSTHRD010 ×8, VSSDK006, VSTHRD110, VSTHRD200, all in old code). NSIS: the same script compiled to a scratch EXE with `/V2` printed no warning (exit 0).

## 6. Tests

- **`smoke.mjs --cli bin\Release\net8.0\claudedev.exe`: 107 passed, 0 failed** (P5's 86 + 21 P6 checks: monitor not listed; calling it says removed and names the replacement, no `monitor.log`; instructions without monitor/DebugView; CLI `monitor` one line, exit 1; five session-state checks; twelve workbench checks: the schema, the workbench's `tools/list` under 6,000 bytes, and ten `vs_get_output` calls, listed in section 3). `TOOL_COUNT` is now 13.
- **Installed CLI (1.4.0 + the P5 deploy): 70 passed, 0 failed**, skipped and named: the P1 checks, the 3 P3 handoff checks, the 4 P4 hook handoff checks, the P5 lessons checks, and the P6 CLI checks ("monitor says it was removed", "session state in the memory root", "the old %APPDATA% file is read once": the installed CLI is the old one).
- **The workbench:** in the smoke test (above) and for real (section 3).
- **The sandbox:** below.
- **The old address:** section 1.

## 7. The sandbox

Installer SHA-256 `BD338FE200BFAA646230748D1084B46E8ABB03BAB92164D4A3FFA90276F1C127`: printed by the host runner and recorded by the sandbox itself (`info.installerSha256`) in every run below, the same as the build's. `results.json` (and `sandbox.log`, the install logs, the smoke output) in each `tools\sandbox-test\results\<run>\` (gitignored). Limits in force (`info.limits`): "installer 1800 s, uninstaller 600 s, download 1800 s, Add-AppxPackage 600 s, app start 300 s, event log 60 s, programs 60-600 s each; watchdog 56 min".

| Run | Scenarios | Result |
|---|---|---|
| `20261112-020251`, offline | T, A, B, C, D, E, F | **79/79** in 15.5 min: **T 4/4, A 16/16, B 9/9, C 9/9, D 10/10, E 16/16, F 15/15**; runner exit 0; the sandbox shut itself down (no sandbox process left) |
| `20261112-022005`, networking on | T, A, F | **36/37** in 14 min: T 4/4, A 16/16, **F 16/17**; runner exit 1 (that one check); the sandbox shut itself down. Every step finished inside its limit (none was stopped) |

**Networked F** (optional; run because the limits now make a hang harmless): CDS installed first on an account that never had Claude Desktop; then Claude Desktop's MSIX from claude.ai **downloaded in 6 s** (297,627,772 bytes; P5 took 2,575 s before `$ProgressPreference` was turned off), **installed** with `Add-AppxPackage` in 7 s (`Claude_5.1231.2.0_x64__pzs8sxrjxfjjc`), and **started** (7 Claude processes after 75 s; in P5 the run hung at this step). PASS: "the config still lists both CDS servers (not replaced)": Claude Desktop rewrote the file (top-level keys now `mcpServers`, `preferences`; not byte-identical) and kept `claudedevstudio` and `cds-workbench` with their paths; PASS: "reads the real %APPDATA% file (no private package copy of the config was made)": no `Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude`; Claude Desktop's own files (`config.json`, `Local State`, `logs`, ...) are in the real `%APPDATA%\Claude`. That answers what P5 left open, the same way machine 3 did. **FAIL: "Claude Desktop started CDS's servers (node running index.js / workbench.js)": 0 processes after 75 s**, and no `mcp*.log` was written under `%APPDATA%\Claude\logs` (none was copied). The likely reason is that Claude Desktop starts MCP servers only for a signed-in user, and the sandbox can't sign in (an inference: not shown). On machine 3, signed in, the servers ran ("Load CDS for C:\CDS_test" worked, GROUND_TRUTH §2). The check stays as written; it can pass only where someone signs in. PASS: the uninstall afterwards removed only the two entries and kept Claude Desktop's folder.

**T** (the limits): "a step over its time limit is stopped, and the script goes on" (stopped after 8 s), "a step within its limit returns its result", "the watchdog fires on time (dry run, 5 s; the real one: 56 min, then shutdown /s /f)", "the real watchdog is running behind this script". **A** fresh install: exit 0 after 647 s (the .NET runtime's MSIs in the sandbox, as in P4/P5), `claudedev version` 1.5.0, the smoke test inside the sandbox (installed `index.js` + installed CLI, i.e. P6's) **105/105** (the two old-store note checks are skipped there, as in P5: the sandbox's Documents is the old store's folder), workbench 13 tools, the Review Panel's caller check, memory in Documents, `configure-claude`. **B** upgrade (22 s; key, config, memory, PATH kept). **C** uninstall (now through `Run-Uninstaller`). **D** Documents redirected (smoke 107/107). **E** Claude Code setup/remove byte for byte. **F** a PC that never had Claude Desktop, and the packaged copy.

## Not done, and why

- **Nothing published, deployed or tagged** (the prompt's rule): the producer's step 2.
- **Dan's main Visual Studio** has the 1.4.0 bridge until Dan installs v1.5.0.
- **The Dashboard's fixed "v1.0.0"** on its About page: noticed, not changed (a code change, not text).
- **The automatic handoff's out-of-project files** (§7 item 23): reported only, as asked.
- **"Claude Desktop starts CDS's servers" in the sandbox:** fails there (no sign-in possible unattended); confirmed only on machine 3, signed in.
- **The experimental instance** keeps the CDS VS Bridge 1.5.0 installed (it is a test hive; `CreateExpInstance /Reset` clears it). The throwaway console app in `%TEMP%` was deleted; the scratch scripts are in `%TEMP%\cds_p6_scratch\`.
