# ClaudeDevStudio — P6 (Claude Code Prompt)
# Contact address, the debug monitor decision, the VS Debug pane, small fixes from P5, the v1.5.0 build (nothing is published here)

---

## Identity

You're working on **ClaudeDevStudio (CDS)**, Claude's persistent-memory and developer-tools system for Claude Desktop and Claude Code, from Gain Publications (Dan). It's **free, MIT, and public**; strangers install it.
- **Project:** `D:\Projects\ClaudeDevStudio` (git `main`; `github.com/dectdan/Claude-Developer-Studio`, **public**). v1.4.0 is released; P5 (search, lessons) is deployed on Dan's PC and goes out in v1.5.0, built here.
- **Memory server:** `mcp-server\index.js` (+ `cds-context.js`, `cds-search.js`, `cds-paths.js`, `cds-hook.js`). **Workbench:** `mcp-server\workbench.js` (VS Bridge tools). **VS Bridge extension:** the VSIX project (find it; §4). **CLI:** root `*.cs`. **Tray app / Dashboard:** `ClaudeDevStudio.UI`, the Dashboard project.

**This session already has the project's context** (Dan's SessionStart hook). The hooks also record your edits and write an automatic handoff when you finish; that's expected.

**You are running unattended.** Claude (the producer) started this session and nobody can answer questions while it runs. When something isn't covered here, take the safest reading that keeps the rules below, write it under "Decisions I made" in `docs\P6_OUTPUT.md`, and carry on. Stop early only if going on would break a rule; then write the output file and say why.

---

## Read first

1. `docs\GROUND_TRUTH.md`, in full (§4, §5, §6, §7 items 4 and 12, §9, §10, §11; the 2026-11-11/12 status lines: machine 3).
2. `docs\P5_OUTPUT.md` (decision 22: `SessionStateManager.cs`; "Not done": the sandbox VM and time limits).
3. The debug monitor: `VSDebugMonitor.cs`, the CLI's `monitor` command, `claudedev_monitor_start` in `index.js`. The VS Bridge: the VSIX project's source, `workbench.js`'s `claudedev_vs_*` tools.
4. `tools\sandbox-test\*`, `Installer\*`, `tools\check-versions.ps1`.

---

## Scope

- **Modified:** whatever the items below need in the CLI, `mcp-server\*`, the VSIX project, the tray app and Dashboard (text only for item 1), `Installer\*`, `tools\sandbox-test\*`, `deploy.ps1`, `README.md`, `CONTRIBUTING.md`, `mcp-server\README.md`, `docs\GROUND_TRUTH.md`, the version files.
- **New:** `docs\releases\RELEASE_NOTES_v1.5.0.md`, `docs\P6_OUTPUT.md`, anything else you need, named in the output.
- **Never touched on this PC:** Dan's `~/.claude/settings.json`, `~/.claude.json`, `%APPDATA%\Claude\claude_desktop_config.json`; the installed copy in `%LOCALAPPDATA%\ClaudeDevStudio`; Dan's memory store (apart from the smoke test's throwaway roots and what the hooks record); any `qwen_config.json` (exclude it from every search, never print it); Dan's main Visual Studio instance and its installed extensions (use the **experimental instance**, item 3); `D:\websites` (a later phase).

---

## Conventions

- Back up any tracked file before editing it (`.bak_YYYYMMDD_HHMM`). Confirm each edit's anchor text before replacing.
- **The CLI owns the memory format and does every memory write** (§6).
- Builds: 0 errors, no new warnings (CLI 42, TrayApp 23, Dashboard 0, VSIX 12 before). NSIS: 0 warnings.
- **The repo is public:** no keys, no personal data, no paths from this PC in shipped files.
- **Don't deploy, tag or release.** The producer publishes v1.5.0 after review.

---

## The work

### 1. The contact address (Dan's decision, 2026-11-12)

Dan's personal e-mail (`danielegain@gmail.com`) must not appear in CDS. **The contact address is `support@gainpublications.com`** (the one Gain Publications' other products use).
- Replace it everywhere it is shown or shipped: the CLI's `ShowHelp`/`ShowVersion`, the tray app's About box, the Dashboard's About/Help, the installer, `README.md`, `CONTRIBUTING.md`, the VSIX manifest, `package.json`/`manifest.json` author fields, anything else a search finds (exclude `qwen_config.json`, `node_modules`, `bin`, `obj`, `.git`). Keep Dan's name where it is a copyright or licence holder ("Daniel E Gain", `LICENSE`).
- `docs\history\` and old release notes are records of the past: leave them, and say how many hits remain there.
- **Don't rewrite git history.** Say in the output that the address remains in history and in published v1.0–v1.4 binaries (a fact, not a task).

### 2. The debug monitor: keep or drop (§7 item 4, §8 Q3)

Decide on evidence. The monitor (`claudedev_monitor_start`, CLI `monitor`, `VSDebugMonitor.cs`) needs Sysinternals DebugView, which CDS can't ship. The VS Bridge already gives build errors, output, debugger state and events. Look at what the monitor does that the bridge (with item 3) doesn't, how often it was used (the chat mirror counts tool calls, `docs\P5_OUTPUT.md` gives the numbers; the activity in the store mentions it), and what it costs (a tool definition in every session; DebugView setup for users).
- **If you drop it:** remove the MCP tool, the CLI command (or leave the command printing one line that it was removed in v1.5.0 and what to use instead; your choice) and `VSDebugMonitor.cs`; update the instructions text, READMEs, tray app/Dashboard if they mention it; `tools/list` size before and after.
- **If you keep it:** say what it gives that nothing else does, and make its tool description honest about DebugView.

### 3. `claudedev_vs_get_output`: the Debug pane (§7 item 12)

Today it returns the Build pane only, so a running program's `Debug.WriteLine`/trace output needs a screenshot. Add a `pane` parameter (`build` the default, `debug`, or any pane name the Output window has; and a way to list the panes), with the same size limits the tool has now (the newest lines first if it must cut). Read the VSIX's code to see how it reads the Build pane and do the same for the others (the Output window service; the Debug pane's well-known GUID).
- **Test it for real in Visual Studio's experimental instance** (`devenv /rootSuffix Exp`; install the VSIX there with `VSIXInstaller /rootSuffix:Exp`, or the project's own F5 setup), never in Dan's main instance: open a tiny throwaway console or test solution in `%TEMP%` that writes to the Debug pane, start it under the debugger, and call the new tool through `workbench.js` (or `show.mjs`) against the bridge's experimental instance. Close the experimental instance when you're done. If this can't be done unattended (a window that needs a click, a licence prompt), say exactly where it stopped, and test what you can (the build, the code path with a fake pane).
- Dan's main Visual Studio gets the new VSIX only when Dan installs v1.5.0.

### 4. Small fixes found in P5

- **`SessionStateManager.cs`** (P5 decision 22): its `session_state.json` in `%APPDATA%\ClaudeDevStudio` is virtualized into Claude's package folder when the CLI runs under the packaged Claude Desktop. Move it out of `%APPDATA%` (to `%LOCALAPPDATA%\ClaudeDevStudio\` or the Documents store; say which and why), read the old location once if the new one doesn't exist, and don't delete the old file. Check nothing else in CDS writes under `%APPDATA%` (apart from Claude Desktop's config, which is meant to) and list what you found.
- **The sandbox kit's time limits** (P5 "Not done"): the host's limit kills only the sandbox's window processes; the VM survives and the next run reattaches. Give `in-sandbox.ps1` its own time limit per step (each installer, download, app start and check), so a stuck step fails as a check and the script still finishes and shuts the sandbox down; and make `run-sandbox-test.ps1` refuse to start while a sandbox VM is already running (say so, and how to close it).
- **The automatic handoff in a real session:** P5's session ended after its output was written. Look at ClaudeDevStudio's `session_handoff.md` / `HANDOFFS.jsonl` and `%LOCALAPPDATA%\ClaudeDevStudio\hooks.log` (read-only) and report whether P5's SessionEnd hook wrote an automatic handoff, and what it says (shortened). Report only.

### 5. Version 1.5.0 and the build

- Bump the one version to **1.5.0**; `tools\check-versions.ps1` passes.
- **`docs\releases\RELEASE_NOTES_v1.5.0.md`**, in the style of v1.4.0's: P5 (`claudedev_search`; lessons for every project; Claude Desktop installed after CDS, and the packaged Claude Desktop's own config copy; `configure-claude` without Claude Desktop) and P6 (the Debug pane; the monitor decision; the contact address; the session-state move). Under "Known": the first install's time (in Windows Sandbox ~10 minutes because of Windows Installer's per-package check; on a real Windows 10 PC, machine 3, the whole first install took about a minute, .NET and Node included).
- Build everything and the installer (`build-setup.ps1`).

### 6. Tests

- **`smoke.mjs --cli bin\Release\net8.0\claudedev.exe`:** everything from P5 passes (86), plus checks for what you changed (the session-state location and the fallback, with a throwaway `%LOCALAPPDATA%`/`%APPDATA%` if you can redirect them; the monitor tool gone or still described honestly; the instructions text).
- **The workbench:** a check that `claudedev_vs_get_output` accepts `pane` and lists panes (without Visual Studio running it must fail politely, as the other VS tools do).
- **The sandbox:** scenarios **A–F offline**, all PASS, with the new time limits in place; record the installer's SHA-256 and confirm it's the one the sandbox ran. Networked F is optional (machine 3 has answered its question; GROUND_TRUTH §2): run it only if the time limits make it safe, and report either way.
- **A search for the old address** across the repo (the same exclusions as item 1) finds nothing outside `docs\history\` and old release notes.

---

## Verification

- Builds: 0 errors, no new warnings (or each new one explained); NSIS 0; `check-versions.ps1`: all 1.5.0.
- Smoke `--cli` all pass; with the installed CLI (v1.4.0 + P5 deploy) it passes what it can and names what it skips.
- The Debug pane: the experimental-instance test's output (shortened), or exactly where it stopped.
- Sandbox A–F offline all PASS; `results.json` saved; the SHA-256 matches.
- No Dan-specific paths and no personal e-mail in shipped files.

---

## On completion

1. **Write `docs\P6_OUTPUT.md`.** Put first what the producer and Dan must do:
   - review; the producer publishes v1.5.0 (the EXE, its SHA-256, the release notes file);
   - what Dan's PC needs (install v1.5.0; reopen Visual Studio for the new VSIX; anything about the moved session state).

   Then: "Decisions I made"; each item with evidence; the monitor decision and why; the Debug pane test; the `%APPDATA%` list; the automatic handoff report; the sandbox table; the installer's size and SHA-256; anything not done, and why.
2. **Update `docs\GROUND_TRUTH.md`:** §2 (a "P6 done" line and **Next**), §3/§4 (what moved, what was added or removed), §7 (items 4 and 12), §9 (P6 ✓; next: the producer publishes v1.5.0, then P7, then **W: the claudedevstudio.com website** — a review against reality and the contact address, after P7), §10, §11, §12 (a P6 row), "Last updated".
3. **Commit** with the message `P6: contact address, debug monitor decision, VS Debug pane, session state out of AppData, sandbox time limits, v1.5.0 build`, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, **then push.** No tag, no release.

=== P6 COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===
