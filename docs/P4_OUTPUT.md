# P4 Output — Claude Code hooks and setup (opt-in), installer polish, the v1.4.0 build

*2026-11-11, Claude Code (Opus 5.5), unattended. Prompt: `docs\P4_prompt.md`. Nothing was deployed, installed, tagged or released. Dan's `~/.claude/settings.json`, `~/.claude.json`, `claude_desktop_config.json`, the installed copy in `%LOCALAPPDATA%\ClaudeDevStudio` and every `qwen_config.json` were not changed (the installed copy's `install.log` and VSIXInstaller's logs in `%TEMP%` were read, nothing more). Claude Code setup ran only in Windows Sandbox and on throwaway files.*

---

## For the producer and Dan

1. **Review** this file and the commit (`P4: Claude Code hooks and setup (opt-in), ...`).
2. **Publish v1.4.0** (the producer, with Dan's yes): a new release `v1.4.0`, attach `Installer\Output\ClaudeDevStudio-Setup.exe` (199.7 MB, SHA-256 `4CAB43DD2A00A6B6CFB083BADE5F57397D1C3FEAEBE7032B37B4838CAB9795A1`), and paste `docs\releases\RELEASE_NOTES_v1.4.0.md` as the text. It is the EXE the sandbox ran (the sandbox recorded the same SHA-256). No tag was made here.
3. **Claude Code on Dan's PC: whether and how.** Recommended: yes, it is what makes the memory work in Dan's headless phase sessions without the prompt having to say "start with claudedev_load". After v1.4.0 is installed (or deployed with `deploy.ps1`, which now copies the new files):
   ```powershell
   claudedev claude-code status     # what is there now
   claudedev claude-code setup      # backs up both files first; uses claude mcp add --scope user (claude.exe is on Dan's PATH)
   ```
   or the tray app's **Set up Claude Code…**. Then start a new Claude Code session in a project: it should open with the project's context ("=== ClaudeDevStudio: … ===", ending "(Loaded at session start by the ClaudeDevStudio hook …)"). `claude mcp list` should show `claudedevstudio` and `cds-workbench`. Undo: `claudedev claude-code remove`.
   Three things to know first:
   - **Phase prompts can drop "call claudedev_load first"** once it is on (it costs a second copy of the same ~7,000 characters). Keeping it is harmless.
   - **Headless `claude -p` runs fire the hooks too.** SessionEnd writes an automatic handoff when a phase session ends; it never replaces an explicit `claudedev_handoff`. Only folders that look like projects are touched.
   - **Not yet seen inside a real Claude Code session** (the sandbox has no Claude Code; running one on Dan's PC would have written Dan's `~/.claude.json`). The hook commands were run exactly as `settings.json` has them, with the input the docs describe. The first real session on Dan's PC is the end-to-end check: if anything is off, `%LOCALAPPDATA%\ClaudeDevStudio\hooks.log` says what.

## Results at a glance

| Check | Result |
|---|---|
| `smoke.mjs --cli bin\Release\net8.0\claudedev.exe` | **55 passed, 0 failed** (40 from P3 + 15 hook checks); session-start 659 ms, session-end 261 ms |
| `smoke.mjs` (installed CLI, v1.3.0 + P3) | **40 passed, 0 failed**; skipped and named: the P1 CLI checks, the 3 P3 handoff checks, the 4 hook handoff checks (need `--cli`) |
| `claude-code-setup-test.js` (throwaway files) | **25 passed, 0 failed** |
| `config-merge-test.js` | 28 passed, 0 failed |
| `load` on ClaudeDevStudio and SongSpark (read-only, `show.mjs`) | **byte-identical** before and after the move to `cds-context.js` (7,256 and 5,026 characters) |
| Builds: CLI / TrayApp / Dashboard / VSIX | 0 errors; **42 / 23 / 0 / 12** warnings (P2: 42 / 23 / 9 / 12; none new) |
| NSIS | 0 warnings |
| `tools\check-versions.ps1` | **all 15 places 1.4.0** |
| Windows Sandbox | **A–E offline: 60 passed, 0 failed** (run `20261111-161023`, 13.5 min); **N + A networked: 18 passed, 0 failed** (`20261111-162720`); N offline 2/2 (`20261111-155843`); S (diagnostic) networked (`20261111-171240`). All four recorded installer SHA-256 `4CAB43DD…95A1`, the same as the host. |
| Installer | 199.7 MB, SHA-256 `4CAB43DD2A00A6B6CFB083BADE5F57397D1C3FEAEBE7032B37B4838CAB9795A1` |
| Path search (shipped files) | no Dan-specific path (one dev note fixed; the two `tools\phase` usage comments left, as in P2) |

## Decisions I made

**The context builder**
1. **`mcp-server\cds-context.js`** holds everything `buildContext` uses, moved by a script that copied the line ranges (so nothing was retyped). Two additions: `buildContext(..., max = LOAD_MAX)` (the hook passes less) and `loadProject(path, {max})`, which is exactly what `handleLoad` did (init on first use, CLI load, build). `index.js` imports it. Proof: `show.mjs` output identical byte for byte on two real projects, smoke 40/40.

**The hook (`mcp-server\cds-hook.js`)**
2. **session-start adds one footer line**: "(Loaded at session start by the ClaudeDevStudio hook; claudedev_load would show the same.)" so Claude doesn't load a second time. The context is built with a cap of 9,500 minus the footer; it still starts with the project header. Measured 659–721 ms on this PC (PowerShell's Documents lookup ~200 ms, CLI ~100–400 ms, Node ~80 ms).
3. **SessionStart matcher `startup|clear|compact`, not `resume`**: a resumed session's transcript already holds the earlier context; adding it again costs ~2,000 tokens for nothing. `timeout: 15` (the default is 600 s; a hung CLI must not hold a session's start).
4. **PreCompact is `async`** (it never delays a compaction) and prints nothing: the docs say a PreCompact hook's stdout becomes instructions for the compaction summary.
5. **SessionEnd is synchronous with `timeout: 5`.** It measured 261–376 ms here, well inside 1.5 s; the timeout raises Claude Code's budget to 5 s only so that a cold .NET start (first run after boot, an antivirus scan) isn't killed in the middle of writing `session_handoff.md`. Not `async`, because the docs say Claude Code ends async hooks still running when a `-p` session tears down, which is exactly when this one runs.
6. **The automatic handoff**: "where I stopped" = "Claude Code session, when the session ended (reason). The last request: …" (400 characters); notes = the files edited (relative to the project, up to 30), Claude's last reply (500 characters) and `claude --resume <session_id>`; next step = "Not stated (an automatic handoff) …". It is written through `claudedev record <path> handoff <json> --auto`, so the CLI keeps P3's rule. A transcript with no conversation, or one that can't be read, writes nothing (a line in `hooks.log`).
7. **Reading the transcript**: at most the last 32 MB; edits counted only from `type: "assistant"` lines that aren't sidechains (the real transcript also has `api-request-blob` lines carrying the same `tool_use` blocks, and subagents' lines); the last request skips tool results, `isMeta` lines, `<command-…>` wrappers and `<system-reminder>` text. The fixture covers each case.
8. **post-tool-use**: `async`; skips failed tool calls and files outside the project (an edit elsewhere isn't this project's work); "once per file per session" is a marker file created with the exclusive flag in the memory folder's `hook_state\<session>\`, so three hooks running at once still record one line (tested). If the CLI fails, the marker is removed so the next edit tries again. Markers older than two days are pruned at session start. The Documents path is cached in `%LOCALAPPDATA%\ClaudeDevStudio\hook_cache.json` (refreshed at every session start), so an edit doesn't start PowerShell.
9. **What counts as a project**, beyond the prompt's list: `.slnx` and any `*.??proj`; **never**: the home folder *and the folder holding it* (`C:\Users`), ProgramData too.
10. **`CDS_HOOK_LOG`** (tests only, like `CDS_CLI_PATH`): the smoke test sends the hook's log to `%TEMP%` so it never writes into the install folder on this PC.

**The CLI**
11. **`record <path> handoff <json> --auto`** and an optional `origin` field on handoffs (left out of the JSON when empty, so older lines are unchanged), rendered as "automatic, from the Claude Code session (session end)". `WriteAutomaticHandoff` now calls the same `RecordAutomaticHandoff`.
12. **`claudedev claude-code setup|remove|status`** runs the installed `cds-claude-code.js` with Node (as `configure-claude` does with `cds-config.js`); anything after the action is passed through (for `--settings`/`--claude-json` in tests). `FindNodeExe` is shared with `configure-claude`.

**Setup (`Installer\cds-claude-code.js`)**
13. **MCP servers**: Claude Code's docs say `~/.claude.json` is a file "it writes for itself; you don't need to edit it", so `claude mcp add --scope user --transport stdio <name> -- <node.exe> <script>` is used when `claude.exe` is on PATH **and** the file in question is the default one. A `claude.cmd` (npm) shim isn't used (exec without a shell needs a real `.exe`); then, as with no Claude Code at all, the script edits `~/.claude.json`'s top-level `mcpServers` itself, writing the same shape the CLI writes (`{"type":"stdio","command":…,"args":[…],"env":{}}`, checked against the CLI below). Idempotent: an entry with the same command and args is left alone; a different one is replaced (`claude mcp remove` then `add`).
14. **The `claude mcp add` path was tried once on this PC against a throwaway `CLAUDE_CONFIG_DIR`** (the docs say it moves `.claude.json` too): setup 1.1 s, both servers written in the shape above, setup again "already registered", remove left `{}`. Dan's `~/.claude.json` was then searched for CDS's server names and the test's paths: no match (one hit for the word "someone" in unrelated text).
15. **The files keep their own style**: indentation, line endings and the final newline are read from the file and written back the same way, so `remove` gives back the exact bytes (tested with 2-space LF and 4-space CRLF files). Hook groups, events, `hooks` and `mcpServers` left empty by `remove` are dropped. A CDS group keeps its place on a second setup (a hook the user added after it stays after it).
16. **Both files are read first; if either isn't valid JSON (or `hooks`/`mcpServers` has the wrong shape) nothing is changed in either** (exit 2). `disableAllHooks: true` is reported.
17. **`setup --if-set-up`** runs on every install: it refreshes the paths for a user who already turned this on (say Node moved) and does nothing for anyone else. That is not turning it on silently: it needs CDS's hooks to be there already.

**Where users turn it on**
18. **Tray app**: one menu item whose text follows the state ("Set up Claude Code…" / "Remove from Claude Code…", from whether `settings.json` mentions `cds-hook.js`), an OK/Cancel explanation (Cancel is the default), then the CLI's output. Also fixed in the tray app: About read the version from GitHub synchronously (a network call that froze the menu); it now prints the assembly's version.
19. **Installer**: the finish page's second checkbox (MUI's "show readme" box, unticked) runs setup and says what happened; the finish text has one line explaining it. `/CLAUDECODE=1` works for silent and interactive installs. The uninstaller runs `remove` with its own message if that fails (the Claude Desktop one would have been misleading).

**Installer polish**
20. **Node.js 26.13.1**: on 2026-11-11 nodejs.org's schedule has v26 "Lithium" as Active LTS (since 2026-10-28), v24 in maintenance, v22 ending 2027-04-30. Active LTS is the line meant for new installs and has the longest support (to 2029-04-30). The build now also checks the MSI against Node's `SHASUMS256.txt` and caches it under its own versioned name (the old cache name would have kept serving 22.14.0). It is installed only on a PC without Node.
21. **The Windows App Runtime check** asks `Get-AppxPackage` for the two MSIX packages its installer registers (seen on this PC: `Microsoft.WindowsAppRuntime.1.8` 8000.994.2142.0 x64/x86 and `MicrosoftCorporationII.WinAppRuntime.Main.1.8`); the old registry key doesn't exist anywhere. **And the Dashboard's `Microsoft.WindowsAppSDK` is pinned to `1.8.*`** (it was `1.*`, resolving to 1.8.260921001 today but to 1.9 the day that ships, while the installer bundles the 1.8 runtime).
22. **VSIXInstaller 2003** is `NoApplicableSKUsException` ("This extension is not installable on any currently installed products"): this PC's `%TEMP%\dd_VSIXInstaller_*.log` from Dan's v1.3.0 install show it for both Build Tools instances (VSIXInstaller first restarts itself from the Visual Studio Installer's copy, "vsixinstaller must be restarted outside of a Visual Studio installation", and that copy refuses). `cds-vsix.ps1` now skips instances whose `productId` is `Microsoft.VisualStudio.Product.BuildTools` with "Build Tools can't host extensions", and names only codes there is evidence for (0, 1001, 1002, 2003); others point at VSIXInstaller's log. No public Microsoft list of these codes was found.
23. **The .NET installer's switches stay** `/install /quiet /norestart` (documented; `/passive` differs only in showing progress), plus `/log` so its log can be read. The time isn't the switches (below).
24. **"Start now" un-elevated** through `explorer.exe <tray app>` from the finish page's run function (Explorer is the user's own, un-elevated process).

**Outside the prompt's file list, and why**
25. **`deploy.ps1`** copies `cds-context.js`, `cds-hook.js` and `cds-claude-code.js`: `index.js` won't start without `cds-context.js`, so a deploy without it would break Dan's memory server.
26. **`LICENSE`** (its GitHub link was the misspelt repo too) and **`Installer\Assets\LOGO_INSTRUCTIONS.txt`** (named a path on this PC).
27. **`tools\sandbox-test\claude-code-setup-test.js`, `claude-code-check.js`** (new test helpers).
28. **The package-lock files' root `version` stays 1.0.0**, as it was through v1.3.0 (`npm ci` doesn't compare it; `check-versions.ps1` doesn't list them).
29. **No memory records for this session** (as P3 decision 16): the prompt allows writes to Dan's store only through the smoke test's throwaway projects. The Identity section's `claudedev_load` at the start updated ClaudeDevStudio's `session_state.json`, as any load does; the four `show.mjs` loads did the same.

## Facts used from Claude Code's docs (read 2026-11-11)

**Hooks**, `https://code.claude.com/docs/en/hooks`:
- Settings shape: `"hooks"` → event → matcher groups → handlers; a command handler has `type`, `command`, optional `args`, `timeout`, `async`, `shell`, `if`, `statusMessage`, `onFailure`.
- **Exec form**: with `args`, "`command` is resolved as an executable and spawned directly with `args` as the argument vector, with no shell involved"; on Windows it must be a real `.exe` (`node` plus a script path is the documented way for scripts).
- Default timeout for command hooks: 600 s. Claude Code doesn't enforce `timeout` on an `async` hook; an async hook gets the same JSON on stdin; in `-p` mode Claude Code kills async hooks still running at teardown.
- Common input: `session_id`, `transcript_path`, `cwd`, `hook_event_name` (also `permission_mode`, `effort`, …). `CLAUDE_PROJECT_DIR` = "the project root where the session started".
- Exit 0: stdout parsed as JSON if it is one object, else plain text; exit 2 blocks on events that can block; other codes are non-blocking errors.
- **SessionStart**: matchers `startup`, `resume`, `clear`, `compact`, `fork`; plain stdout on exit 0 is added to Claude's context; **capped at 10,000 characters** (longer output goes to a file with a 2,000-character preview).
- **PreCompact**: matchers `manual`, `auto`; input adds `trigger`, `custom_instructions`; **exit 2 blocks compaction**; on exit 0 **stdout becomes instructions for the compaction summary**.
- **SessionEnd**: input adds `reason` (`clear`, `resume`, `logout`, `prompt_input_exit`, `other`); no decision control; **1.5 s default budget**; a per-hook `timeout` raises the budget to the highest one, up to 60 s; `CLAUDE_CODE_SESSIONEND_HOOKS_TIMEOUT_MS` overrides it.
- **PostToolUse**: matcher on tool names (letters and `|` = exact names); input `tool_name`, `tool_input` (Write/Edit: `file_path`, absolute, backslashes on Windows), `tool_response`.
- The transcript is JSON lines ("conversation JSON") under `~/.claude/projects/…/<session>.jsonl`, written asynchronously.

**MCP**, `https://code.claude.com/docs/en/mcp`: `claude mcp add [options] <name> -- <command> [args...]`; `--scope local|project|user` (`-s`); `--transport stdio`; `claude mcp remove <name> --scope <scope>`; local and **user** scope are stored in `~/.claude.json` (user scope at its top level); an entry with no `type` is stdio.

**Settings**, `https://code.claude.com/docs/en/settings`: user settings `~/.claude/settings.json` (`%USERPROFILE%\.claude` on Windows; `CLAUDE_CONFIG_DIR` moves it); lists merge across levels; settings files are strict JSON; **edits to `hooks` are picked up without a restart**; `~/.claude.json` "it writes for itself; you don't need to edit it". **`https://code.claude.com/docs/en/claude-directory`**: with `CLAUDE_CONFIG_DIR`, `.claude.json` moves under it too.

## The work, with evidence

### 1. One context builder, shared
`mcp-server\cds-context.js` (557 lines, 21 exports); `index.js` imports it (1,081 → 571 lines). Before/after `show.mjs claudedev_load`: ClaudeDevStudio 7,256 = 7,256 characters, SongSpark 5,026 = 5,026, `diff` empty for both. Smoke `--cli` 40/40 straight after the move.

### 2. `cds-hook.js`
Smoke (`--cli`, final run):
```
PASS  hook session-start prints load's context: starts with the project header, 9,500 characters or less (2091, 721 ms)
PASS  hook session-start is fast (under 2 s: 721 ms)
PASS  hook session-start keeps a big project to 9,500 characters or less (7969)
PASS  hook session-start creates the memory of a new project on first use
PASS  hook skips C:\Windows\System32 (cwd only): no output, exit 0, no memory folder created or changed
PASS  hook skips C:\Windows\System32 (CLAUDE_PROJECT_DIR): no output, exit 0, no memory folder created or changed
PASS  hook skips the home folder: no output, exit 0, no memory folder created or changed
PASS  hook skips a drive root: no output, exit 0, no memory folder created or changed
PASS  hook skips a folder that does not look like a project (no memory created)
PASS  hook post-tool-use records one activity line per file per session
PASS  hook session-end writes an automatic handoff within 1.5 s (376 ms)
PASS  the next load shows the automatic handoff first
PASS  hook pre-compact writes an automatic handoff and prints nothing
PASS  hook session-end never replaces an explicit handoff (it goes to HANDOFFS.jsonl only)
PASS  hook with an unreadable transcript writes nothing, exits 0 and logs the reason (not to stdout)
```
(The post-tool-use check sends Edit a.js twice, Write b.js, MultiEdit a.js, Read b.js, an edit outside the project, then three hooks at once for b.js in another session: exactly 3 lines.) A skipped folder costs ~80 ms. Afterwards no `_cds_*` memory folders, no `%TEMP%` leftovers, no `hooks.log` in the install folder.

**The sample transcript** `mcp-server\test\fixtures\transcript-sample.jsonl` follows the real shape (checked against this session's own transcript, keys only): `user` lines with string content, `assistant` lines with one block each (`thinking`, `tool_use`, `text`), `user` tool results, an `api-request-blob` line and a sidechain edit (both must not count), an `isMeta` line, a `<system-reminder>` inside the request, a `<command-name>/exit</command-name>` line, `last-prompt`.

### 3. Setting it up for Claude Code
`claude-code-setup-test.js` 25/25 (setup on seeded files, servers and hooks once each, matchers and timing, seeded content unchanged, no BOM, backups equal the originals; setup twice changes nothing and makes no backup; status; remove byte for byte, twice; CRLF/4-space; no files; invalid JSON and a wrong-shaped `hooks` change nothing; order kept; a moved install updated in place). The `claude mcp add` path: decision 14. Tray app and installer: decisions 18–19, sandbox E below.

### 4. Installer polish
Decisions 20–24 and the .NET timing below. `cds-vsix.ps1 -ListOnly` on this PC:
```
Visual Studio Build Tools 2022 17.14.37710.0 (67078cbd) : skipped: Build Tools can't host extensions (the VS Bridge needs the Visual Studio IDE).
Visual Studio Community 2022 17.14.37710.0 (c7705ad0) : would run ...\Community\Common7\IDE\VSIXInstaller.exe /quiet /instanceIds:c7705ad0 "...CdsVsBridge.vsix"
Visual Studio Build Tools 2019 16.11.37627.13 (de4c6b4b) : skipped: Build Tools can't host extensions (the VS Bridge needs the Visual Studio IDE).
```
`mcp-server\README.md` rewritten: the files, all 12 + 13 tools, the hook, testing, a config entry without anyone's paths.

### 5. Version 1.4.0
`Directory.Build.props`, both `package.json`, `manifest.json`, `setup.nsi`, the VSIX manifest and package: `check-versions.ps1` "All 15 places say 1.4.0." (also run by the build).

### 6. Tests
Above, and the sandbox below.

## The sandbox

Runs (results in `tools\sandbox-test\results\<run>\`, gitignored; each has `results.json`, `sandbox.log`, the install, uninstall and .NET logs, the smoke output):

| Run | Scenarios | Network | Result | Installer SHA-256 recorded in the sandbox |
|---|---|---|---|---|
| `20261111-155843` | N | off (0 adapters up) | 2 passed, 0 failed (8.5 min) | `4CAB43DD…95A1` |
| `20261111-161023` | **A, B, C, D, E** | **off** (0 adapters) | **60 passed, 0 failed** (13.5 min) | `4CAB43DD…95A1` |
| `20261111-162720` | N, **A** | **on** (1 adapter) | **18 passed, 0 failed** | `4CAB43DD…95A1` |
| `20261111-171240` | S (diagnostic) | on | 8 readings (below) | `4CAB43DD…95A1` |

(A first attempt at S, `20261111-165027`, stopped on a bug in the new diagnostic code: a variable named `$res` overwrote the results folder `$Res`, since PowerShell names ignore case. Fixed and rerun as `20261111-171240`. It was added to `in-sandbox.ps1` after the A–E run, behind `-Scenarios S`, so it changes nothing in A–E.)

Sandbox: `WDAGUtilityAccount`, elevated, Windows 11 Enterprise 10.0.26100, no Node, no .NET, no Visual Studio, no Claude Code.

**A–E offline (`20261111-161023`):**

| | Check | Result | Evidence |
|---|---|---|---|
| A | installer /S exits 0 | PASS | exit 0 after 646 s |
| A | program files are in place | PASS | 19 files present under C:\Users\WDAGUtilityAccount\AppData\Local\ClaudeDevStudio |
| A | claudedev version prints 1.4.0 | PASS | exit 0: ClaudeDevStudio v1.4.0  |
| A | Node.js is installed | PASS | C:\Program Files\nodejs\node.exe v26.13.1 |
| A | a silent install without /CLAUDECODE=1 leaves Claude Code alone (opt-in) | PASS | settings.json exists: False; .claude.json exists: False |
| A | config: both CDS entries (full node.exe path, files exist); keep-me, preferences, someOtherSetting unchanged; no BOM | PASS | servers: keep-me, claudedevstudio, cds-workbench; keep-me {"command":"cmd","args":["/c","echo"]}; preferences {"sidebarMode":"chat"}; someOtherSett... |
| A | config backup exists and equals the file before install | PASS | 1 backup(s): claude_desktop_config.json.bak-cds-20261111-162124 |
| A | qwen_config.json exists with all keys empty | PASS | providers: together, groq, deepinfra, fireworks, openrouter; empty: together, groq, deepinfra, fireworks, openrouter  |
| A | user PATH: the long PATH kept (plus Node.js's npm folder), CLI folder added once, still REG_EXPAND_SZ | PASS | kind ExpandString; length 1828 (expected 1828); ends with: ...ming\npm;C:\Users\WDAGUtilityAccount\AppData\Local\ClaudeDevStudio\CLI |
| A | auto-start entry written on a first install | PASS | "C:\Users\WDAGUtilityAccount\AppData\Local\ClaudeDevStudio\TrayApp\ClaudeDevStudio.TrayApp.exe" |
| A | memory server smoke test (installed index.js + installed CLI) passes | PASS | exit 0; 53 passed, 0 failed  |
| A | workbench server lists 13 tools | PASS | count 13: fetch_url, claudedev_vs_get_state, claudedev_vs_get_errors, claudedev_vs_get_output, claudedev_vs_get_events, claudedev_vs_get_debugger, ... |
| A | Review Panel from the installed files: caller-check.mjs passes | PASS | panel up: True; exit 0; 7 passed, 0 failed |
| A | memory lands in [Documents]\ClaudeDevStudio\Projects\SandboxProj | PASS | server says: C:\Users\WDAGUtilityAccount\Documents\ClaudeDevStudio\Projects\SandboxProj; expected: C:\Users\WDAGUtilityAccount\Documents\ClaudeDevS... |
| A | claudedev configure-claude (tray app "Link Claude Desktop") exits 0 | PASS | exit 0: Configuring Claude Desktop integration... / / ClaudeDevStudio: adding its servers to C:\Users\WDAGUtilityAccount\AppData\Roaming\Claude\cla... |
| A | config after configure-claude: still everything kept, each CDS entry once | PASS | servers: keep-me, claudedevstudio, cds-workbench; keep-me {"command":"cmd","args":["/c","echo"]}; preferences {"sidebarMode":"chat"}; someOtherSett... |
| B | test key put into qwen_config.json (groq) | PASS |  |
| B | installer /S exits 0 | PASS | exit 0 after 21 s |
| B | upgrade: the Windows App Runtime is found, not installed again | PASS | [setup] Checking Windows App Runtime... / [setup] Windows App Runtime 1.8 already installed. |
| B | upgrade: the .NET 8 Desktop Runtime is found, not installed again | PASS | [setup] Checking .NET 8 Desktop Runtime... / [setup] .NET 8 Desktop Runtime 8.0.34 found. |
| B | the API key is still there after the upgrade (others still empty) | PASS | empty: together, deepinfra, fireworks, openrouter  |
| B | config: keep-me, preferences, someOtherSetting unchanged; each CDS entry once | PASS | servers: keep-me, claudedevstudio, cds-workbench; keep-me {"command":"cmd","args":["/c","echo"]}; preferences {"sidebarMode":"chat"}; someOtherSett... |
| B | memory from A untouched | PASS | 7 items in C:\Users\WDAGUtilityAccount\Documents\ClaudeDevStudio\Projects\SandboxProj, same before and after |
| B | user PATH: CLI folder still there once, rest unchanged | PASS | kind ExpandString; length 1828 (expected 1828); ends with: ...ming\npm;C:\Users\WDAGUtilityAccount\AppData\Local\ClaudeDevStudio\CLI |
| B | claudedev version still 1.4.0 | PASS | ClaudeDevStudio v1.4.0  |
| C | uninstaller /S ran to the end | PASS | exit 0; finished after 11 s |
| C | config: CDS entries gone; keep-me, preferences, someOtherSetting remain; no BOM | PASS | servers: keep-me; keep-me {"command":"cmd","args":["/c","echo"]}; preferences {"sidebarMode":"chat"}; someOtherSetting 42; BOM False |
| C | config backed up before the uninstall changed it | PASS | backups: 1 before, 2 after |
| C | memory folder under Documents untouched | PASS | 11 items in C:\Users\WDAGUtilityAccount\Documents\ClaudeDevStudio, same before and after |
| C | keys file: removed with the install folder (as documented) | PASS | qwen_config.json exists after uninstall: False |
| C | no CDS files left in the install folder | PASS | C:\Users\WDAGUtilityAccount\AppData\Local\ClaudeDevStudio removed |
| C | user PATH: exactly as before CDS was added (Node.js, which stays, keeps its npm folder) | PASS | kind ExpandString; length 1766 (expected 1766); ends with: ...ong Folder Name 45\bin;C:\Users\WDAGUtilityAccount\AppData\Roaming\npm |
| C | registry entries and Start menu folder removed | PASS | registry left: False; Start menu folder left: False |
| C | kept on purpose: Node.js and .NET runtime still installed | PASS | node: True; .NET Desktop: 8.0.34 |
| D | MyDocuments (new process) returns RedirectedDocs | PASS | GetFolderPath('MyDocuments') = C:\Users\WDAGUtilityAccount\RedirectedDocs |
| D | installer /S exits 0 | PASS | exit 0 after 22 s |
| D | program files are in place | PASS | 19 files present under C:\Users\WDAGUtilityAccount\AppData\Local\ClaudeDevStudio |
| D | claudedev version prints 1.4.0 | PASS | exit 0: ClaudeDevStudio v1.4.0  |
| D | Node.js is installed | PASS | C:\Program Files\nodejs\node.exe v26.13.1 |
| D | config: both CDS entries added again; keep-me, preferences, someOtherSetting unchanged | PASS | servers: keep-me, claudedevstudio, cds-workbench; keep-me {"command":"cmd","args":["/c","echo"]}; preferences {"sidebarMode":"chat"}; someOtherSett... |
| D | memory server smoke test (installed index.js + installed CLI) passes | PASS | exit 0; 55 passed, 0 failed  |
| D | memory lands in [Documents]\ClaudeDevStudio\Projects\SandboxProjD | PASS | server says: C:\Users\WDAGUtilityAccount\RedirectedDocs\ClaudeDevStudio\Projects\SandboxProjD; expected: C:\Users\WDAGUtilityAccount\RedirectedDocs... |
| D | installer made its data folders under RedirectedDocs | PASS | Projects: True; Backups: True |
| D | nothing CDS-related created or changed in C:\Users\WDAGUtilityAccount\Documents | PASS | 12 items, same before and after D |
| E | no Claude Code here (claude.exe not on PATH): setup edits ~/.claude.json itself | PASS | claude.exe on PATH: False |
| E | claudedev claude-code setup exits 0 | PASS | exit 0: ClaudeDevStudio: setting up Claude Code / Backup: C:\Users\WDAGUtilityAccount\.claude.json.bak-cds-20261111-162316 / MCP servers: wrote cla... |
| E | CDS hooks (4) and servers (2) there once each; everything seeded unchanged; no BOM | PASS | hooks: PostToolUse:post-tool-use, SessionStart:session-start, PreCompact:pre-compact, SessionEnd:session-end; servers: keep-me, claudedevstudio, cd... |
| E | both files backed up first | PASS | 2 backup(s) |
| E | setup a second time changes nothing (same bytes, no new backup) | PASS | exit 0; same: True; backups 2 |
| E | claudedev claude-code status reports it set up | PASS | ClaudeDevStudio and Claude Code: / MCP server claudedevstudio: registered (user scope) / MCP server cds-workbench: registered (user scope) / Hook S... |
| E | hook as written: session-start prints load's context (header first, 755 chars <= 9500, 1729 ms) | PASS | exit 0; === ClaudeDevStudio: SandboxProjE === Memory folder: C:\Users\WDAGUtilityAccount\RedirectedDocs\ClaudeDevStudio\Projects\SandboxProjE New p... |
| E | hook as written: session-start from C:\Windows\System32 prints nothing and creates no memory folder | PASS | exit 0/0; out 0/0; System32 memory folder: false |
| E | hook as written: post-tool-use (async, three at once for one file) records one activity line | PASS | codes 0,0,0; [{"id":"ACT20261111_8d3fbeae","timestamp":"2026-11-11T16:23:20.1898161-06:00","action":"file_edit","description":"Edited src\\app.js (... |
| E | hook as written: session-end writes an automatic handoff within 1.5 s (225 ms) | PASS | exit 0; <!-- cds-handoff: auto --> # Handoff: SandboxProjE *Written 2026-11-11 16:23 (automatic, from the Claude Code session (session end)) · HND0... |
| E | hook as written: pre-compact with an unreadable transcript writes nothing, prints nothing, exits 0 | PASS | exit 0; handoffs 1 -> 1 |
| E | claudedev claude-code remove: both files byte for byte as seeded | PASS | exit 0; / ClaudeDevStudio: removing its Claude Code setup / Backup: C:\Users\WDAGUtilityAccount\.claude.json.bak-cds-20261111-162320 / MCP servers:... |
| E | set up again before the uninstall | PASS |  |
| E | the uninstaller takes CDS out of Claude Code: both files byte for byte as seeded | PASS | uninstaller exit 0 after 11 s;  |
| E | installer /S /CLAUDECODE=1 exits 0 | PASS | exit 0 after 21 s |
| E | a silent install with /CLAUDECODE=1 sets Claude Code up (seeded entries kept) | PASS | hooks: PostToolUse:post-tool-use, SessionStart:session-start, PreCompact:pre-compact, SessionEnd:session-end;  |

**N + A with networking on (`20261111-162720`):**

| | Check | Result | Evidence |
|---|---|---|---|
| N | .NET runtime /install /quiet /norestart (network adapters up: 1) | PASS | exit 0 after 487 s; biggest gaps in its log: 123 s between [[1E54:1E58][2026-11-11T16:33:40]i301: Applying execute package: windowsdesktop_runtime_... |
| N | .NET runtime /uninstall /quiet (so A installs it again through the installer) | PASS | exit 0 after 5 s; left: ; biggest gaps: 2 s between [[14F8:19E8][2026-11-11T16:35:44]i301: Applying execute package: windowsdesktop_runtime_8.0.34_... |
| A | installer /S exits 0 | PASS | exit 0 after 665 s |
| A | program files are in place | PASS | 19 files present under C:\Users\WDAGUtilityAccount\AppData\Local\ClaudeDevStudio |
| A | claudedev version prints 1.4.0 | PASS | exit 0: ClaudeDevStudio v1.4.0  |
| A | Node.js is installed | PASS | C:\Program Files\nodejs\node.exe v26.13.1 |
| A | a silent install without /CLAUDECODE=1 leaves Claude Code alone (opt-in) | PASS | settings.json exists: False; .claude.json exists: False |
| A | config: both CDS entries (full node.exe path, files exist); keep-me, preferences, someOtherSetting unchanged; no BOM | PASS | servers: keep-me, claudedevstudio, cds-workbench; keep-me {"command":"cmd","args":["/c","echo"]}; preferences {"sidebarMode":"chat"}; someOtherSett... |
| A | config backup exists and equals the file before install | PASS | 1 backup(s): claude_desktop_config.json.bak-cds-20261111-164651 |
| A | qwen_config.json exists with all keys empty | PASS | providers: together, groq, deepinfra, fireworks, openrouter; empty: together, groq, deepinfra, fireworks, openrouter  |
| A | user PATH: the long PATH kept (plus Node.js's npm folder), CLI folder added once, still REG_EXPAND_SZ | PASS | kind ExpandString; length 1828 (expected 1828); ends with: ...ming\npm;C:\Users\WDAGUtilityAccount\AppData\Local\ClaudeDevStudio\CLI |
| A | auto-start entry written on a first install | PASS | "C:\Users\WDAGUtilityAccount\AppData\Local\ClaudeDevStudio\TrayApp\ClaudeDevStudio.TrayApp.exe" |
| A | memory server smoke test (installed index.js + installed CLI) passes | PASS | exit 0; 53 passed, 0 failed  |
| A | workbench server lists 13 tools | PASS | count 13: fetch_url, claudedev_vs_get_state, claudedev_vs_get_errors, claudedev_vs_get_output, claudedev_vs_get_events, claudedev_vs_get_debugger, ... |
| A | Review Panel from the installed files: caller-check.mjs passes | PASS | panel up: True; exit 0; 7 passed, 0 failed |
| A | memory lands in [Documents]\ClaudeDevStudio\Projects\SandboxProj | PASS | server says: C:\Users\WDAGUtilityAccount\Documents\ClaudeDevStudio\Projects\SandboxProj; expected: C:\Users\WDAGUtilityAccount\Documents\ClaudeDevS... |
| A | claudedev configure-claude (tray app "Link Claude Desktop") exits 0 | PASS | exit 0: Configuring Claude Desktop integration... / / ClaudeDevStudio: adding its servers to C:\Users\WDAGUtilityAccount\AppData\Roaming\Claude\cla... |
| A | config after configure-claude: still everything kept, each CDS entry once | PASS | servers: keep-me, claudedevstudio, cds-workbench; keep-me {"command":"cmd","args":["/c","echo"]}; preferences {"sidebarMode":"chat"}; someOtherSett... |

Notes: A's smoke is 53 (not 55) because in the sandbox the old store is the same folder as the real one, so the two "older entries" checks skip themselves (as in P2); D's is 55. In E the session-start hook took 1,729 ms (the sandbox's first start of that project; 659–721 ms on this PC).

## The .NET 8 Desktop Runtime: where the 8 minutes go

**Measured** (Windows Sandbox, the bundled `windowsdesktop-runtime-8-x64.exe` 8.0.34, `/install /quiet /norestart /log`):

| | Networking off | Networking on |
|---|---|---|
| The runtime's installer on its own (scenario N) | **487 s** | **487 s** |
| …of which, per MSI, Windows Installer's "SOFTWARE RESTRICTION POLICY: Verifying package" step | 120 s × 4 (runtime, hostfxr, host, Windows Desktop) | 120 s × 4 |
| …the rest (Burn, the actual install) | ~7 s | ~7 s |
| Its uninstall | 5 s | 5 s |
| Through the CDS installer (scenario A, from `install.log`): .NET | 8 min 10 s | 8 min 11 s |
| Node.js 26.13.1 MSI (one MSI) | 2 min 10 s | 2 min 10 s |
| Windows App Runtime | 10 s | 30 s |
| CDS itself | a few seconds | a few seconds |
| An upgrade (B), runtimes already there | 21 s in all | — |

Example, the first MSI's own log (offline): `[15:59:02:518] SOFTWARE RESTRICTION POLICY: Verifying package --> ...dotnet-runtime-8.0.34-win-x64.msi` then `[16:01:02:796] ... has a digital signature`, then the install itself in 2 s. Networked: `[16:27:37:173]` → `[16:29:37:428]`, the same 120 s.

**Why, as far as it could be measured** (diagnostic scenario S, networking on):
- the network works: `msftconnecttest` 325 ms, `ocsp.digicert.com` 63 ms, the Windows root-certificate list (`ctldl.windowsupdate.com/.../authrootstl.cab`) 189 ms, `crl.microsoft.com` answers in 151 ms;
- the same files' signatures check in **0.2–0.4 s** with `Get-AuthenticodeSignature` (the .NET EXE 378 ms, the Node MSI 204 ms; both Valid);
- yet `msiexec /i` of the Node MSI on its own still spends **120.4 s** in the same step (`[17:12:58:289]` → `[17:14:58:691]`);
- the sandbox has **Smart App Control in evaluation mode** (`HKLM\SYSTEM\CurrentControlSet\Control\CI\Policy` `VerifiedAndReputablePolicyState` = 2) and a Safer policy key; this PC has Smart App Control off (0) and the same key.

**Conclusion:** the 8 minutes are Windows Installer's own policy check of each signed MSI in this clean Windows image, a flat 120 s each, with or without a network. **It is not the installer's switches** (`/install /quiet /norestart` are the documented quiet switches; `/passive` only adds a progress window; none touches that check), and it is not certificate-revocation lookups (they answer in under 0.2 s and the signatures verify in under 0.4 s). The likely cause is Smart App Control's evaluation mode, which a fresh Windows 11 has and most upgraded PCs don't; that is an inference, not proven. Not measured on a real PC without .NET 8 (none here). Nothing changed in the installer for it except `/log`, so the next report has the runtime's own log. (My first guess, from the offline run alone, was revocation timeouts; the networked runs ruled that out.)

## The installer

`Installer\Output\ClaudeDevStudio-Setup.exe`: 199.7 MB (209,383,972 bytes), SHA-256 `4CAB43DD2A00A6B6CFB083BADE5F57397D1C3FEAEBE7032B37B4838CAB9795A1`, built 2026-11-11 15:54 by `build-setup.ps1` in 2.6 min (exit 0). Recompiling with NSIS gives the same SHA-256. The P3 test build is kept beside it as `ClaudeDevStudio-Setup.exe.bak_20261111_1532_p3build` (gitignored).

## Not done, and why

- **The hooks were not run by a real Claude Code** (above, "For the producer"). Everything Claude Code would do was reproduced from its docs: exec form, stdin, `CLAUDE_PROJECT_DIR`, the timeouts are configured but their enforcement is Claude Code's.
- **"Start now" un-elevated was not observed**: the sandbox has no split admin token, and launching the tray app on this PC would start the installed copy.
- **The .NET first-install delay is not fixed**: it is Windows Installer's own 120 s policy check of each signed MSI in a clean Windows image, network or not (above), not CDS's switches. The ways around it (self-contained .NET apps, a zip instead of the MSIs) change what CDS ships and belong in a later phase if they are wanted. Whether a real PC without .NET 8 sees it was not measured.
- **The CLI and DLL files carry their build path in the PDB reference** (`D:\Projects\ClaudeDevStudio\obj\...`), as every earlier release did. Not a personal detail (no user name), so left; `-p:DebugType=embedded`/PathMap would remove it.
- **The CLI's help still prints an e-mail address** (`ShowHelp`, `ShowVersion`, the tray About box), as since v1.0. The README dropped it in P2; whether the program should is Dan's call.

=== P4 COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===
