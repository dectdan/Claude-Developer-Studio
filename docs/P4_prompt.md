# ClaudeDevStudio — P4 (Claude Code Prompt)
# Claude Code hooks and setup (opt-in), installer polish, the v1.4.0 release build (nothing is published here)

---

## Identity

You're working on **ClaudeDevStudio (CDS)**, Claude's persistent-memory and developer-tools system for Claude Desktop, from Gain Publications (Dan). It's **free, MIT, and public**; strangers install it.
- **Project:** `D:\Projects\ClaudeDevStudio` (git `main`; `github.com/dectdan/Claude-Developer-Studio`, **public**).
- **Memory server:** `mcp-server\index.js` (+ `cds-paths.js`, `templates\`). **CLI:** root `*.cs` (`claudedev.exe`, owns the memory files). **Installer:** `Installer\build-setup.ps1`, `setup.nsi`, `cds-config.js`, `cds-vsix.ps1`, `cds-path.ps1`. **Sandbox test kit:** `tools\sandbox-test\`.

Start with ClaudeDevStudio: `claudedev_load` with `D:\Projects\ClaudeDevStudio`.

**You are running unattended.** Claude (the producer) started this session and nobody can answer questions while it runs. When something isn't covered here, take the safest reading that keeps the rules below, write it under "Decisions I made" in `docs\P4_OUTPUT.md`, and carry on. Stop early only if going on would break a rule; then write the output file and say why.

---

## Why

Today CDS's memory works only when Claude remembers to call it. Sessions get absorbed in work, skip `claudedev_load`, and never record anything. That's half of why the memory sat empty for months.

Claude Code has **hooks**: commands it runs at set points. That lets memory happen whether or not Claude remembers:
- the project's state is loaded when a session starts;
- a handoff is written before the context is compacted and when the session ends;
- edits leave a light trail.

Claude Code sessions also don't get the CDS tools unless CDS is registered with Claude Code itself (on Dan's PC, `claude mcp list` showed none).

This must be **opt-in**: it changes how a user's Claude Code behaves, so CDS never turns it on silently. It also must never cost the user anything when it misbehaves.

Then the small installer items left from P2 (ground truth §7 item 18), and the v1.4.0 build.

---

## Read first

1. `docs\GROUND_TRUTH.md`, in full. Pay attention to §4, §5 (efficiency; the method), §6, §7 item 18, §9, §10 and §11.
2. `docs\P2_OUTPUT.md` (the installer decisions; "Where the first install's time goes") and `docs\P3_OUTPUT.md` (how `load` is built; its decisions).
3. `mcp-server\index.js` (`buildContext` and its helpers), `mcp-server\cds-paths.js`, `Installer\cds-config.js` (the pattern for editing a user's JSON config safely), `Installer\setup.nsi`, `Installer\build-setup.ps1`, `tools\sandbox-test\*`.
4. **Claude Code's own documentation, current version.** Read it; don't rely on memory. Note the facts you use, with the URL, in the output:
   - **hooks:** `https://code.claude.com/docs/en/hooks`, and the hooks guide it links;
   - **MCP setup and scopes:** the Claude Code MCP page (`claude mcp add --scope user`, `~/.claude.json`);
   - **settings file locations:** the settings page.

   Facts the producer has already confirmed from the hooks page (2026-11-11):
   - **settings:** hooks live under `"hooks"` in `~/.claude/settings.json` (user scope), as event → matcher groups → handlers; entries from different levels merge;
   - **SessionStart:** stdout on exit 0 is added to Claude's context, with matchers `startup`, `resume`, `clear`, `compact`. Output is **capped at 10,000 characters** (longer goes to a file, with only a 2,000-character preview);
   - **SessionEnd:** hooks share a **1.5-second budget** by default (a per-hook `timeout`, up to 60, raises it), and its output doesn't matter;
   - **PreCompact:** matchers `manual` and `auto`. **Exit 2 blocks compaction: never exit 2;**
   - **PostToolUse:** matches tool names (`Edit|Write`);
   - **async:** `"async": true` runs a hook in the background;
   - **every event's input:** `session_id`, `transcript_path`, `cwd`, `hook_event_name`;
   - **environment:** `CLAUDE_PROJECT_DIR` is the project root;
   - **exec form** (`"command"` an `.exe` plus `"args"`) avoids the shell. `node.exe` with a script path works.

---

## Scope

- **Modified:**
  - `mcp-server\index.js` (move the context builder into a module both it and the hook use; no behaviour change);
  - the CLI where needed (a `claude-code` command, an automatic flag on `record handoff`);
  - `ClaudeDevStudio.UI` (a tray menu item);
  - `Installer\build-setup.ps1`, `setup.nsi`, `cds-vsix.ps1` (log wording);
  - the files item 18 names;
  - `Directory.Build.props` and everything `tools\check-versions.ps1` checks (1.4.0);
  - `tools\sandbox-test\*`, `mcp-server\test\smoke.mjs`;
  - `README.md`, `mcp-server\README.md`, `docs\GROUND_TRUTH.md`.
- **New:**
  - `mcp-server\cds-hook.js`;
  - `mcp-server\cds-context.js` (or a name you choose);
  - `Installer\cds-claude-code.js` (or inside `cds-config.js`, your choice);
  - `docs\releases\RELEASE_NOTES_v1.4.0.md`;
  - `docs\P4_OUTPUT.md`.
- **Never touched on this PC:**
  - Dan's `~/.claude/settings.json`, `~/.claude.json` and `%APPDATA%\Claude\claude_desktop_config.json`;
  - the installed copy in `%LOCALAPPDATA%\ClaudeDevStudio`;
  - Dan's memory store, except `smoke.mjs`'s throwaway projects;
  - any `qwen_config.json` (exclude it from every search).

  **Claude Code setup runs only inside Windows Sandbox,** or against throwaway config files you point it at.

---

## Conventions

- Back up any tracked file before editing it (`.bak_YYYYMMDD_HHMM`). Confirm each edit's anchor text before replacing.
- **The CLI owns the memory format and does every memory write** (§6). Hooks write memory through the CLI.
- **A user's config files get the `cds-config.js` treatment:**
  - keep everything that isn't CDS's;
  - back up first;
  - write through a temp file and rename; UTF-8, no BOM;
  - invalid JSON stays untouched and the user is told.
- **Hooks must never hurt a session:**
  - always exit 0;
  - never block a tool;
  - never block compaction;
  - write errors to a log file, not to Claude;
  - stay fast.
- Builds: 0 errors, no new warnings. NSIS: 0 warnings.
- **The repo is public:** no keys, no personal data, no paths from this PC in shipped files.
- **Don't deploy, tag or release.**

---

## The work

### 1. One context builder, shared

- Move `index.js`'s context building (`buildContext` and everything it uses) into a module that `index.js` and the hook both import.
- **`claudedev_load`'s output must not change.** P3's smoke checks prove it.

### 2. `cds-hook.js`

It's run by Claude Code as `node.exe <install>\mcp-server\cds-hook.js <event>`, exec form, with the hook input on stdin.

**Which project:**
- the project is `CLAUDE_PROJECT_DIR`, else the input's `cwd`;
- **skip quietly** (exit 0, no output, no memory created) unless the folder looks like a project: it holds `.git`, `docs\`, a solution/project file, or `package.json`/`pyproject.toml`/`Cargo.toml`/`go.mod`;
- **always skip** the user's home folder itself, Windows' folders, Program Files, and drive roots. This is the bug that made project folders named `system32` (§7 item 1).

**The events:**
- **`session-start`:** print the same context as `claudedev_load`, capped at **9,500 characters** (Claude Code's limit is 10,000). It creates the memory folder on first use, like load. Keep it fast (aim under 2 s); say what it measured.
- **`pre-compact` and `session-end`:** write an **automatic** handoff through the CLI. It must never replace an explicit handoff; P3's rule, kept by the CLI. Build it from what's cheap and certain:
  - the transcript's last user request (short);
  - the files edited in this session (from the transcript's Edit/Write/MultiEdit/NotebookEdit tool calls);
  - the last thing Claude said (short).

  It must finish well inside SessionEnd's 1.5-second budget, or be set up `async`, or with a `timeout` it fits; say which and why. If the transcript can't be read, write nothing.
- **`post-tool-use`** (matcher `Edit|Write|MultiEdit|NotebookEdit`, `async`): record a light activity line (`file_edit`, the file path relative to the project) through the CLI, **at most once per file per session.** Keep that small state in the project's memory folder.

**Errors** go to `%LOCALAPPDATA%\ClaudeDevStudio\hooks.log`, which is capped, and never to stdout, except for session-start's context.

### 3. Setting it up for Claude Code (opt-in)

**A CLI command, `claudedev claude-code setup | remove | status`,** backed by a Node script like `cds-config.js`. It should:
- **register the two CDS MCP servers for Claude Code at user scope.** Use the method the current docs recommend; if that's `claude mcp add --scope user`, use it when `claude` is on PATH, otherwise edit `~/.claude.json` with the same care;
- **add the four hooks to `~/.claude/settings.json`,** marked so `remove` takes out only CDS's (for example, every CDS command contains `cds-hook.js`); everything else stays;
- **`status`** says what's set up;
- **be idempotent** (setup twice changes nothing the second time);
- **for `remove`,** restore exactly what was there apart from CDS's entries.

**Where users turn it on:**
- a tray app menu item, "Set up Claude Code…" / "Remove from Claude Code", with a short explanation and a confirmation;
- the installer's finish page, as an **unticked** checkbox;
- silent installs leave it off unless a documented switch is given (for example `/CLAUDECODE=1`).

**The uninstaller** runs `remove`.

**The README** gets a short section: what it does, how to turn it on and off, and what it changes in which files.

### 4. Installer polish (§7 item 18 and the logs)

- **Links:** the Dashboard and tray app links point at the right repo (`Claude-Developer-Studio`).
- **Registry:** the Dashboard reads the registry values the installer actually writes.
- **"Start now"** on the finish page starts the tray app **un-elevated.**
- **Windows App Runtime:** the check matches what its installer really registers, so the runtime isn't reinstalled every time.
- **The bundled Node.js:** the current LTS line's latest release (check nodejs.org; verify the signature as `build-setup.ps1` already does). Say which, and why that line.
- **`cds-vsix.ps1`'s log** describes Build Tools honestly. Find what exit code 2003 really means; "Visual Studio is running" was logged for Build Tools instances on Dan's PC. Say "Build Tools can't host extensions" when that's the case.
- **Why the .NET 8 Desktop Runtime took 8 minutes in the offline sandbox.** Try its documented quiet-install switches, then measure in the sandbox **with networking on and off.** Fix it if it's the installer's switches; otherwise report the numbers.
- **`mcp-server\README.md`:** bring it up to date (it describes 7 tools from before v1.3.0).

### 5. Version 1.4.0

Bump the one version; `tools\check-versions.ps1` passes.

### 6. Tests

**`smoke.mjs`:** the P3 checks still pass. Add hook checks, run directly with sample stdin against throwaway projects:
- **`session-start`:**
  - prints a context that starts with the project header and is ≤ 9,500 characters;
  - from `C:\Windows\System32`, or the user's home folder, it prints nothing and creates no memory folder;
- **`post-tool-use`:** records one activity line per file per session;
- **`session-end`:** writes an automatic handoff within 1.5 seconds and never replaces an explicit one; with an unreadable transcript it writes nothing and exits 0.

**Use a sample transcript** in the shape the docs describe, saved under `mcp-server\test\fixtures\`.

**The sandbox kit** gets **scenario E**, Claude Code setup, inside the sandbox:
1. Seed `~/.claude/settings.json` with an unrelated hook, `permissions` and an unrelated key, and `~/.claude.json` with an unrelated MCP server.
2. Run `claudedev claude-code setup`. Check:
   - CDS's hooks and servers are there, once;
   - everything seeded is unchanged;
   - there's no BOM;
   - backups exist.
3. Run `setup` again: no change.
4. Run the hook commands exactly as written in `settings.json`, with sample stdin (the sandbox has no Claude Code). Check they behave as in the smoke checks.
5. Run `remove`: the seeded files are back to exactly what they were, apart from the backups.
6. Uninstall runs `remove` too.

**Then run A–E offline,** and A once more **with networking on**, for the .NET timing.

---

## Verification

- **Builds:** CLI, TrayApp, Dashboard and VSIX: 0 errors, no new warnings. NSIS: 0 warnings. `check-versions.ps1`: all 1.4.0.
- **Smoke tests:** `smoke.mjs --cli bin\Release\net8.0\claudedev.exe` passes everything; `smoke.mjs` with the installed CLI passes what it can and names what it skips.
- **The sandbox:** A–E all PASS offline, plus the networked A, with `results.json` saved. Put the installer's SHA-256 in the output, and confirm it's the one the sandbox recorded.
- **The `load` output** on `D:\Projects\ClaudeDevStudio` and `D:\Projects\SongSpark` (read-only, `show.mjs`) is unchanged in shape from P3.
- **No Dan-specific paths** in shipped files (the same search as P2, excluding `qwen_config.json`).

---

## On completion

1. **Write `docs\P4_OUTPUT.md`.** Put first what the producer and Dan must do:
   - review; the producer publishes v1.4.0 with Dan's yes;
   - whether and how Dan turns on Claude Code setup on his PC.

   Then:
   - "Decisions I made";
   - the facts used from Claude Code's docs, with URLs;
   - each item with evidence;
   - the sandbox table;
   - the .NET timing;
   - the installer's size and SHA-256;
   - anything not done, and why.
2. **Update `docs\GROUND_TRUTH.md`:**
   - **§2:** a "P4 done" line;
   - **§3 and §4:** the hook, the setup command, the new files;
   - **§7:** item 18 fixed, or say what's left;
   - **§9:** P4 ✓, next: publish v1.4.0, then P5;
   - **§10:** how to test hooks;
   - **§11:** any new rule that bites;
   - **§12:** a P4 row;
   - "Last updated".
3. **Commit** with the message `P4: Claude Code hooks and setup (opt-in), installer polish, v1.4.0 build; sandbox scenario E`, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, **then push.** No tag, no release.

=== P4 COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===
