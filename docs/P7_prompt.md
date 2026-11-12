# ClaudeDevStudio — P7 (Claude Code Prompt)
# Claude runs Claude Code from CDS: start a phase, read its status, answer it, stop it (in source; nothing is published here)

---

## Identity

You're working on **ClaudeDevStudio (CDS)**, Claude's persistent-memory and developer-tools system for Claude Desktop and Claude Code, from Gain Publications (Dan). It's **free, MIT, and public**; strangers install it.
- **Project:** `D:\Projects\ClaudeDevStudio` (git `main`; `github.com/dectdan/Claude-Developer-Studio`, **public**). v1.5.0 is released.
- **Workbench server:** `mcp-server\workbench.js` (VS Bridge tools, model tools, `fetch_url`, the Review Panel). **Memory server:** `mcp-server\index.js` (+ modules). **The producer's scripts this phase turns into tools:** `tools\phase\run-phase.ps1`, `tools\phase\phase-status.ps1`.

**This session already has the project's context** (Dan's SessionStart hook). The hooks record your edits and write an automatic handoff when you finish; that's expected.

**You are running unattended.** Claude (the producer) started this session and nobody can answer questions while it runs. When something isn't covered here, take the safest reading that keeps the rules below, write it under "Decisions I made" in `docs\P7_OUTPUT.md`, and carry on. Stop early only if going on would break a rule; then write the output file and say why.

---

## Why

Since P2 the producer (Claude, in a Claude Desktop chat) has run every phase by hand: write `docs\Pn_prompt.md`, start `claude -p` headless with `run-phase.ps1`, check `docs\Pn_run.log` every 15–20 minutes with `phase-status.ps1`, read `docs\Pn_OUTPUT.md`, verify, write the next prompt. It works (P2–P6 ran this way, 15 minutes to 2 hours each), but it needs a shell on the PC and two scripts nobody else has. P7 makes it part of CDS, so any CDS user's Claude can run the method end to end: plan in chat, build in Claude Code, check in chat.

It is also the most powerful thing CDS will do: it starts an agent that edits files. So it must be explicit, contained and easy to stop.

---

## Read first

1. `docs\GROUND_TRUTH.md`, in full (§4, §5, §6, §9 "How the producer runs a phase", §10, §11).
2. `tools\phase\run-phase.ps1` and `phase-status.ps1` (what they do and why: stdin from NUL, the stream-json log, the `.json` metadata, shared-read of a locked log, question detection, the allowed tools, no bypass).
3. `docs\P2_OUTPUT.md`…`P6_OUTPUT.md`, the parts about running phases and the hooks (a phase session gets load's context from the hook; SessionEnd writes an automatic handoff).
4. **Claude Code's current docs** (read them; don't rely on memory; cite what you use with URLs): headless/`-p` mode, `--output-format stream-json`, `--resume`/`--session-id`, `--permission-mode`, `--allowedTools`, `--model`, `--effort`, `--mcp-config`, exit codes, and how a `-p` run reports a result. Facts the producer has used (Claude Code 2.1.311 on Dan's PC): `claude -p "<prompt>" --model <m> --effort <e> --permission-mode acceptEdits --allowedTools <list> --output-format stream-json --verbose < NUL`; the last line is a `result` event with `session_id`, `subtype`, `is_error`, `num_turns`, `duration_ms`; `claude -p --resume <session_id> "<reply>"` continues it.

---

## Scope

- **Modified:** `mcp-server\workbench.js` (new tools), `mcp-server\test\smoke.mjs` (or a new test file for the workbench), `tools\phase\*` (they may become thin wrappers over the same module, your choice), `deploy.ps1`/`Installer\setup.nsi`/`build-setup.ps1` if you add a shipped file, the Dashboard (item 5), `mcp-server\cds-hook.js` (item 5), `README.md`, `mcp-server\README.md`, `docs\GROUND_TRUTH.md`.
- **New:** a module for the phase runner (e.g. `mcp-server\cds-phase.js`), `docs\P7_OUTPUT.md`, test fixtures.
- **Never touched on this PC:** Dan's `~/.claude/settings.json`, `~/.claude.json`, `%APPDATA%\Claude\claude_desktop_config.json`; the installed copy in `%LOCALAPPDATA%\ClaudeDevStudio`; Dan's memory store (apart from the smoke test's throwaway roots and what the hooks record); any `qwen_config.json` (never print it); Dan's projects other than this one (the real test uses a throwaway project in `%TEMP%`); `D:\websites`.

---

## Conventions

- Back up any tracked file before editing it (`.bak_YYYYMMDD_HHMM`). Confirm each edit's anchor text before replacing.
- **Never `--dangerously-skip-permissions`, never `--permission-mode bypassPermissions`,** in code, tests or docs examples.
- Builds: 0 errors, no new warnings (CLI 33, TrayApp 14, Dashboard 0, VSIX 12 before). NSIS 0.
- **The repo is public:** no keys, no personal data, no paths from this PC in shipped files.
- **Don't deploy, tag or release. No version bump** (the producer decides when P7 ships).

---

## The work

### 1. The tools (in the workbench server)

Names are yours; these are the jobs. Keep each description short (the workbench's `tools/list` is 4,315 bytes now; report it after).

- **Start a phase:** `project_path`, `phase` (e.g. `P8`); the prompt is `docs\<phase>_prompt.md` in that project and **must exist** (the tool never takes a free-form prompt to start a session: the prompt is a file the user can read first). Optional `model`, `effort` (passed through only when given; no defaults that assume Dan's plan), `allowed_tools` (else the default list below). It starts `claude -p` detached, as `run-phase.ps1` does, writes `docs\<phase>_run.log` / `.err` / `.json`, and returns at once with the pid, the log path and how to check it. It refuses (with the reason and what to do): no Claude Code on PATH or too old for the flags it needs (say which version); a folder that doesn't look like a project (the hook's rule, `cds-hook.js`); the home folder, Windows, Program Files, a drive root; **another phase already running in that project** (the lock: section 2).
- **Status:** `project_path`, optional `phase` (else the newest). What `phase-status.ps1` reports, compact: running/finished/stopped, minutes, tool calls, permission denials (with the tool names), the newest few lines of Claude's text, the result (subtype, turns, duration), whether the end looks like a question, and whether `docs\<phase>_OUTPUT.md` exists. Reads a log another process is writing (shared read). **Budget about 2,500 characters.**
- **Reply:** `project_path`, `phase`, `message`. Continues the same session (`--resume <session_id>` from the log's result or init event), with the same model, effort and allowed tools, logging to the same files (appended, or a numbered continuation; your choice, and Status must show it). Refuses while that session is still running.
- **Stop:** `project_path`, `phase`. Ends the session's process tree (Claude Code and anything it started), releases the lock, and records that it was stopped by request. Never touches other processes.
- **The default allowed tools** are `run-phase.ps1`'s list, with CDS's own memory tools named by their current names (the 13 from P6, plus the workbench's if a phase needs them: say which). Permission mode `acceptEdits`. The run's MCP config: CDS's memory server from the install, as `run-phase.ps1` does.

### 2. The lock, and what survives a restart

- One phase per project at a time: a lock file in the project's `docs\` (or the `.json` metadata) holding the pid and start time, checked against the live process (a stale lock from a crashed or rebooted run is cleared, and Status says so).
- The session must outlive the MCP server: Claude Desktop restarts its servers when it is reopened, and a phase can run for two hours. Start it detached and hidden; Status and Stop work from a new server process (they read the `.json`, not memory).
- Windows only is fine (CDS is Windows); say so in the descriptions where it matters.

### 3. Safety, in the tool descriptions and the README

Short and plain: what starting a phase does (an agent that reads, edits and runs commands in that project, with the listed tools, without asking; no bypass of Claude Code's permissions); that Claude Desktop asks the user before each tool call unless they chose "always allow" (check Claude Desktop's current behaviour from a source, or say you couldn't); how to stop it (Stop, or end the process); where the logs are. The README gets a "Running phases from chat" section: the method (ground truth → `Pn_prompt.md` → `Pn_OUTPUT.md`), the four tools, the safety lines, and that it uses the user's own Claude Code sign-in and plan.

### 4. The producer's scripts

`run-phase.ps1` and `phase-status.ps1` either call the new module (thin wrappers) or stay as they are and say in a header comment that the tools replace them. Your choice; keep them working either way (the producer may use them while P7 is deployed).

### 5. Small fixes left from P6

- **The Dashboard's About page shows a fixed "v1.0.0":** show the assembly's version (1.5.0 now).
- **The automatic handoff lists files outside the project** (GROUND_TRUTH §7 item 23): list only the project's files (as post-tool-use does) and say how many outside ones were left out, in one line.

### 6. Tests

- **Smoke (without Claude Code):** point the runner at a **fake `claude`** (a small script or exe in the test folder that writes a stream-json log like the real one: init, a few assistant/tool events, a result with a session id; one variant that ends in a question; one that runs until killed; one that exits with an error) through a test-only override (like `CDS_VS_BRIDGE_PORT`), against throwaway projects in `%TEMP%`. Check: start refuses a missing prompt file, a non-project folder, System32, a drive root, and a second start while one runs; start returns at once; status while running and after (counts, result, question detection, OUTPUT present or not, budget); a stale lock is cleared; reply refuses while running and continues with `--resume <id>` and the same flags after (check the arguments the fake received); stop ends the fake and its child and releases the lock; the default allowed tools never include a bypass; nothing is written outside the throwaway project and `%TEMP%`.
- **One real run** (Dan's Claude Code is signed in on this PC): a throwaway project in `%TEMP%` (a `docs\` folder and a one-line `README.md`), `docs\T1_prompt.md` asking for something tiny and checkable (create `docs\hello.txt` with a given line, then write `docs\T1_OUTPUT.md` with one sentence, and end by asking one question), started through the workbench tools over MCP stdio as Claude Desktop would call them, with **`model: "claude-haiku-5-5"`** and `effort: "low"` to keep it cheap. Then: status until finished; the question detected; a reply through the tool; status shows the continuation finished; stop tested on a second short run (`T2`, a prompt that would take a while) after it has started. Report the outputs (shortened) and the times. Delete the throwaway project afterwards. Note: Dan's Claude Code hooks are on, so these sessions get a SessionStart context and write automatic handoffs into a throwaway project's memory: report what you see, then remove that throwaway project's memory folder (it's yours; name it clearly, e.g. `cds_p7_throwaway`), and nothing else.
- **The installer:** if you add a shipped file, update `deploy.ps1` and `setup.nsi`, rebuild, and run the sandbox offline **A–F** (the time limits from P6 are in place); confirm the SHA-256. If no shipped file is added, no sandbox run is needed; say so.

---

## Verification

- Builds: 0 errors, no new warnings; NSIS 0 (if built).
- Smoke `--cli bin\Release\net8.0\claudedev.exe`: everything from P6 (107) plus the new checks pass; the installed copy's run passes what it can and names what it skips.
- The real run: the outputs, as above.
- The workbench's `tools/list` size before and after.
- No bypass flag anywhere (`git grep -n "dangerously\|bypassPermissions"` shows only text that forbids it).
- No Dan-specific paths in shipped files.

---

## On completion

1. **Write `docs\P7_OUTPUT.md`.** Put first what the producer must do: review; deploy with `deploy.ps1` (what it copies); how the producer runs P8/W with the new tools instead of the scripts; whether a release is worth it now. Then: "Decisions I made"; the facts used from Claude Code's docs, with URLs; each item with evidence; the real run; the safety text as shipped; anything not done, and why.
2. **Update `docs\GROUND_TRUTH.md`:** §2 (a "P7 done" line and **Next**), §3/§4 (the module, the tools, the lock), §7 (item 23 and anything new), §9 (P7 ✓; "How the producer runs a phase" now with the tools; next: deploy, then W), §10 (testing the runner), §11, §12 (a P7 row), "Last updated".
3. **Commit** with the message `P7: run Claude Code phases from CDS (start, status, reply, stop; one per project); Dashboard version; handoff lists project files only`, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, **then push.** No tag, no release.

=== P7 COMPLETE — STOPPED FOR SCOPE. Awaiting review. ===
