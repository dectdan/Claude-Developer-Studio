# ClaudeDevStudio — Ground Truth

*Last updated: 2026-11-12 (v1.7.3 published)*

**Read this first.** It is the single source of truth for the project. **It is the current state, not a log:** when a fact changes, replace it here; don't append. The history (dated status entries, fixed problems, earlier detail) is in `docs\history\GROUND_TRUTH_history.md`, CDS's memory, the `docs\Pn_OUTPUT.md` files and git. Older status files are in `docs\history\` and describe states that no longer exist.

---

## 1. What This Is

**ClaudeDevStudio (CDS)** gives Claude persistent memory of software projects across sessions, plus a workbench of developer tools, through Claude Desktop's MCP protocol.

- **Origin:** Dan asked Claude what it would build to make its own existence better; CDS was Claude's answer. Claude designed it; Dan's name is on it for licensing and copyright. (Dan, 2026-11-11: "this is your baby.")
- **Who uses it:** Claude itself, in Claude Desktop chats and in Dan's Claude Code sessions. Every phased prompt in Dan's other projects starts with `claudedev_load` (SongSpark, Takehouse, Lazarus, SynapseBridge, Argus...).
- **Distribution:** free, MIT licence, public repository, Windows 10/11 x64 installer from GitHub releases.

---

## 2. Status

**Released:** v1.7.3 (2026-11-12, GitHub release `v1.7.3`, asset SHA-256 `1DF43556BB335C0EC8554AD7E049A450AB3FCD7614F5CC9E247046CA812BF558`): project memory (the CLI and the `claudedevstudio` MCP server: load, handoffs, mistakes, decisions, lessons for every project, search), the workbench (`cds-workbench`: phases from chat in three modes, VS Bridge tools, AI delegation), Claude Code hooks set up by default when Claude Code is there, whole-store backups (daily, before every upgrade, on demand) with export/import and restore, the tray app and the Dashboard (Phases and Backups pages); load names the project's `HOW_WE_WORK.md`/`CONVENTIONS.md` in one line, and the scaffold's templates carry Dan's whole method (including "test in proportion to the change"). **Installed:** Dan's PC v1.7.3 through the installer (19:32, the final build: its templates match the source); machine 3 v1.7.3 (upgraded 2026-11-12: clean `install.log`; the SessionStart hook on a throwaway project printed the `Rules:` line). **Website:** v1.7.3, uploaded by Dan. **Open:** §7 items 35 (AI delegation) and 36 (update check), both deferred by Dan; further work comes from using CDS on Dan's projects.

**Next:** nothing open; further work comes from using CDS on Dan's projects (deferred: §7 items 35 and 36).

---

## 3. Locations

| What | Where |
|---|---|
| Repository | `github.com/dectdan/Claude-Developer-Studio` (**public**, `main`) |
| Source | `D:\Projects\ClaudeDevStudio` |
| Installed program | `%LOCALAPPDATA%\ClaudeDevStudio\` — `CLI\claudedev.exe`, `TrayApp\`, `Dashboard\`, `mcp-server\` (index.js, workbench.js, node_modules, qwen_config.json, qwen_config.template.json), `review-server\`, `VSExtension\CdsVsBridge.vsix`, `cds-config.js`, `cds-claude-code.js`, `cds-vsix.ps1`, `cds-path.ps1`, `install.log`; in `mcp-server\` also `cds-context.js`, `cds-hook.js`, `cds-search.js`, `cds-paths.js`, `cds-phase.js`, `templates\`; and (once the hook has run) `hooks.log` (capped at 256 KB), `hook_cache.json` (the Documents path for post-tool-use) |
| Claude Code config (once set up) | `%USERPROFILE%\.claude\settings.json` (`"hooks"`: four entries running `cds-hook.js`) and `%USERPROFILE%\.claude.json` (user-scope `"mcpServers"`: `claudedevstudio`, `cds-workbench`); both move with `CLAUDE_CONFIG_DIR`. Backups `<file>.bak-cds-YYYYMMDD-HHMMSS` beside them. Per project, the hook's once-per-file markers are in the memory folder's `hook_state\<session>\` (pruned after 2 days). |
| Installer source | `Installer\setup.nsi`, `build-setup.ps1`, `cds-config.js` (Claude Desktop's config), `cds-claude-code.js`, `cds-vsix.ps1`, `cds-path.ps1` (user PATH); runtimes cached in `Installer\downloads\` (gitignored); staging in `Installer\build\`, the EXE in `Installer\Output\`. |
| Installer tests | `tools\sandbox-test\` (Windows Sandbox, section 10); results in `tools\sandbox-test\results\<run>\` (gitignored) |
| **Memory (the real store)** | `[Documents]\ClaudeDevStudio\Projects\<project folder name>\` where `[Documents]` is Windows' Documents folder (`Environment.SpecialFolder.MyDocuments`). On Dan's PC: `C:\Users\Big_D\OneDrive\Documents\ClaudeDevStudio` |
| Lessons for every project (from P5) | `[Documents]\ClaudeDevStudio\LESSONS.jsonl` (one per machine; written by the CLI's `lesson` command; `LESSONS.jsonl.bak` after an edit or remove) |
| Old store (v1.2.x MCP only) | `%USERPROFILE%\Documents\ClaudeDevStudio` — read-only from v1.3.0 on; merged by the script |
| VS Bridge state files | `[Documents]\ClaudeDevStudio\VSBridge\` (live panes from P6 come over HTTP, `localhost:62000`, not from files) |
| CLI active-project state (`switch`/`active`; from P6) | `[Documents]\ClaudeDevStudio\cli_session_state.json` (`MemoryPaths.Root`). The pre-1.5.0 `%APPDATA%\ClaudeDevStudio\session_state.json` is read once if the new file doesn't exist, never deleted |
| Claude Desktop config | `%APPDATA%\Claude\claude_desktop_config.json` (entries `claudedevstudio`, `cds-workbench`; the installer backs it up as `claude_desktop_config.json.bak-cds-YYYYMMDD-HHMMSS` before each change). The packaged (MSIX) Claude Desktop may read its own copy instead: `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\Claude\claude_desktop_config.json` (history file, §7 item 20); `cds-config.js` updates every such copy that exists. Dan's PC has none (it uses the real file). |
| AI provider keys | `%LOCALAPPDATA%\ClaudeDevStudio\mcp-server\qwen_config.json` (gitignored; the repo has `qwen_config.template.json` with empty keys). The installer creates it from the template only if it doesn't exist; the uninstaller removes it with `mcp-server\`. |
| MCP logs | `%APPDATA%\Claude\logs\mcp-server-claudedevstudio.log`, `mcp-server-cds-workbench.log`, `mcp.log` |
| Phase runs (in the project) | `docs\<phase>_run.log` (stream-json; replies appended), `.err`, `.json` (the run's record), `docs\cds_phase.lock` (while a run lives), `docs\phase_runs\` (earlier runs); the run's MCP config and a reply's message in `%TEMP%`. This repo's `.gitignore` covers them. |
| Backups made 2026-11-11 | `D:\Backups\ClaudeDevStudio\2026-11-11_memory_before_fix\` |
| **Store backups** | `[Documents]\ClaudeDevStudio\Backups\store\ClaudeDevStudio-store-<yyyyMMdd-HHmmss>-<kind>.zip`, kind `daily` (newest 14 kept), `upgrade` (newest 4 kept), `manual`, `pre-restore`, `pre-import` (never deleted); `backup.lock` while one is being made; `cds-backup-manifest.json` inside each. Per-project backups (the older format): `Backups\<project>\`. |
| OneDrive conflict copies, once merged (P10) | `[Documents]\ClaudeDevStudio\Backups\conflicts\<project>\` (root files: `_store\`); never deleted |
| Files an import kept aside (P10) | `[Documents]\ClaudeDevStudio\Backups\import-kept\<yyyyMMdd-HHmmss>\<path>` (the older of two different non-JSON-lines files) |
| An export, by default (P10) | `[Documents]\ClaudeDevStudio-export-<yyyyMMdd-HHmmss>.zip` (beside the store, not in it) |

---

## 4. Architecture (v1.7.3)

| Part | Built from | What it does |
|---|---|---|
| **CLI** `claudedev.exe` | root `*.cs`, `ClaudeDevStudio.csproj` (.NET 8) | Owns the memory format and does every write (`ClaudeMemory.cs`, `MemorySchemas.cs`, `Lessons.cs`, `StoreBackup.cs`). 31 commands; the servers use `init`, `load`, `record`, `check`, `stats`, `lesson`; `git`, `cloud`, `sync`, `monitor` only say they were removed. Output: UTF-8 to pipes, UTF-16 to a console, ASCII marks. `CDS_MEMORY_ROOT` moves the memory root (`MemoryPaths.Root`), tests only. |
| **Memory MCP server** `claudedevstudio` | `mcp-server\index.js` (Node, MCP SDK 1.29) | Thin wrapper: writes through the CLI (argument array, never a shell string), reads the memory files and the project's `docs\`. 13 tools: `claudedev_init`, `_load` (creates the memory on first use), `_scaffold`, `_handoff`, `_record_decision`, `_record_activity`, `_record_mistake`, `_check_mistake`, `_stats`, `_chat_checkpoint`, `_chat_resume`, `_search`, `_record_lesson`. Short `instructions` on the method. The scaffold's templates: `mcp-server\templates\*.md`. |
| **Context builder** | `mcp-server\cds-context.js` | `loadProject`/`buildContext`: what `claudedev_load` and the hook's session-start print (below); the mistake rule's words (`STOP`, `keywords`). |
| **Search** | `mcp-server\cds-search.js` | `claudedev_search` across every project's memory and the lessons, ranked, ~3,000 characters; read-only. The mistake rule's thresholds. |
| **Claude Code hook** | `mcp-server\cds-hook.js` | `node.exe cds-hook.js <event>`, input on stdin. `session-start`: load's context (≤ 9,500 characters) plus a footer line. `pre-compact`, `session-end`: an automatic handoff from the transcript (`record <path> handoff <json> --auto`; never replaces an explicit one; lists only the project's files). `post-tool-use`: one `file_edit` activity per file per session. Only folders that look like projects (never home, Windows, Program Files, drive roots). Always exits 0; errors to `hooks.log`. |
| **Claude Code setup** | `Installer\cds-claude-code.js` + `claudedev claude-code setup\|remove\|status` | On by default when the installer finds Claude Code (`/CLAUDECODE=0` or an earlier "no" skips it). Servers at user scope, hooks in `settings.json` (SessionStart `startup\|clear\|compact`, PreCompact, SessionEnd, PostToolUse on edits); `remove` gives back the exact bytes. `status` starts with `State:` (not-installed, too-old, not-signed-in, not-set-up, ready); the tray item follows it. |
| **Workbench MCP server** `cds-workbench` | `mcp-server\workbench.js` | 17 tools: the four `claudedev_phase_*`, VS Bridge ×7 (`claudedev_vs_get_output` takes `pane`: build, debug, a name or GUID, list), `qwen_generate`, `list_models`, `generate_image` (§7 item 35), `display_review`, `display_image`, `fetch_url`. Starts the Review Panel. |
| **Shared paths** | `mcp-server\cds-paths.js` | Asks Windows for Documents once (PowerShell with `PS_UTF8`); the project rule (`isExcluded`, `looksLikeProject`) for the hook and the phase tools; `conflictCopyOf`; `findOnPath` (instead of `where.exe`). |
| **Phase runner** | `mcp-server\cds-phase.js` | `claudedev_phase_start`/`_status`/`_reply`/`_stop` (Windows). **Start** runs only `docs\<phase>_prompt.md`; refuses non-projects, a Claude Code missing, older than 2.1.0 or not signed in, and a second run (`docs\cds_phase.lock`); starts a runner through WMI (it outlives Claude Desktop) that runs `claude -p … --permission-mode acceptEdits --allowedTools <list> --output-format stream-json`, the 60-minute ceilings set, output to `docs\<phase>_run.log`, the record in `_run.json`. **Modes:** collaborative (default), delegated, manual (a visible Windows Terminal window). **Status** (~2,500 characters): state, tool calls, denials, latest words, the result, a `QUESTION:` block word for word, "Open it: claude --resume <id>". **Reply:** `--resume`, the message on stdin. **Stop:** Ctrl+C first (SessionEnd hooks run), then force. Outcomes in `[Documents]\ClaudeDevStudio\phases.json`. `CDS_PHASE_CLAUDE`: a fake, tests only. Detail: the history file, §4. |
| **Phases page** | `ClaudeDevStudio.Dashboard\Views\PhasesPage.xaml(.cs)` | A project's phases and one as a readable conversation, refreshed while it runs; Stop, Open in Claude Code, Open folder. Never answers a question. `Dashboard.exe --phases [<project> [<phase>]]`. |
| **Phase notifications** | `ClaudeDevStudio.UI\PhaseWatcher.cs` | Polls `phases.json` every 15 s; one notification per change (finished, question, stopped, failed); click opens the Phases page. `CDS_TRAY_EVENT_LOG`, tests only. |
| **Store backups, export/import, restore, conflict copies** | `StoreBackup.cs` (CLI), `StoreStatus.cs` (also in the tray and the Dashboard) | Whole-store zips with a manifest (SHA-256 per file): daily (started by `load` in the background; the tray hourly), before every upgrade (the installer), on demand (`backup --all`). `export`/`import [--dry-run]` merge (no entry lost or doubled; backs up first); `restore` replaces (backs up first, never deletes). OneDrive conflict copies merged on load/record/lesson. The sync line (OneDrive) in `backup --status`, `status`, the tray, the Dashboard. |
| **VS Bridge** | `VSExtension\CdsVsBridge` (VSIX) | Inside Visual Studio: state, errors and output files in `[Documents]\ClaudeDevStudio\VSBridge\`; HTTP on `localhost:62000` (Host must be `localhost`) for debugger, build, navigate, evaluate, `GET /panes`, `GET /pane`; refuses a foreign `Origin`/`Host`. |
| **Review Panel** | `review-server\server.js` (Express) | `127.0.0.1:63000`, shows code and images that Claude sends; refuses a foreign `Origin`/`Host`. |
| **TrayApp** | `ClaudeDevStudio.UI` (WinForms) | Tray icon, auto-start, Configure AI Keys (live key check), **Memory backups** (status line, Back up now, Export…, Import…, Open folder), **Phases…**, phase notifications, the Claude Code item. Reads the CLI's output as UTF-8. |
| **Dashboard** | `ClaudeDevStudio.Dashboard` (Blazor WebView) | Memory browser; the Phases and Backups pages. |
| **Installer** | `Installer\setup.nsi` + `build-setup.ps1` (NSIS) | `ClaudeDevStudio-Setup.exe` (~200 MB, offline: Node 26.13.1 LTS, .NET 8 Desktop Runtime, Windows App Runtime 1.8), elevated, `/S`, `/CLAUDECODE=0\|1`. Adds only CDS's entries (Claude Desktop config, user PATH, the VSIX in every Visual Studio); keeps keys, settings and other servers; `install.log` in UTF-8. |

**The memory format (written by the CLI):** per project, `Activity\YYYY-MM-DD.jsonl`, `MISTAKES.jsonl`, `DECISIONS.jsonl`, `PATTERNS.jsonl`, `PERFORMANCE.jsonl`, `session_state.json`, `FACTS.md`, `UNCERTAINTIES.md`, `session_handoff.md`, `HANDOFFS.jsonl`, `file_digests.json`; at the root `LESSONS.jsonl` (`LSN###`), `cli_session_state.json`, `phases.json`, `chat_mirror.jsonl`. IDs are the file's highest + 1 (`ERR###`, `DEC###`, `HND###`, …). Every handoff is appended to `HANDOFFS.jsonl`; `session_handoff.md` holds the latest, and an automatic one never replaces an explicit one (`<!-- cds-handoff: explicit -->`). The project name is `Path.GetFileName(project_path)`. JSON field names: the history file, §4.

**What `load` shows, in order:** the header (any `OneDrive:` merge lines); the last handoff and its age; the ground truth (`docs\GROUND_TRUTH.md`, else `docs\*GROUND*TRUTH*.md`, else the root's): title, "Last updated", the last ~2,500 characters of its Status and the last `**Next:**`; **one line naming the project's `CONVENTIONS.md`/`HOW_WE_WORK.md` (`docs\` or the root) to read before changing anything** (P12); the open questions; a note for either file missing; the newest `docs\P*_OUTPUT.md`; mistakes, lessons for every project, decisions, facts, patterns, activity. No ground truth: a block offering `claudedev_scaffold` (only with the user's OK). **Budget:** aims at 8,000, never over 12,000 (the hook 9,500), trimmed from activity up; the handoff, the Status and the rules lines never.

**The scaffold's templates** (`mcp-server\templates\`: `GROUND_TRUTH.md`, `CONVENTIONS.md`, `HOW_WE_WORK.md`) are the one home of Dan's method (P12): generic, for strangers; `{{PROJECT}}`, `{{DATE}}`, `{{SUMMARY}}` filled in; never overwritten (exclusive flag), and a ground truth under another name stops a second one. Projects scaffolded earlier keep their older copies.

---

## 5. Decisions (Dan)

- **Two MCP servers, direct config entries, no Claude Extensions system** (2026-04-05). Claude Desktop rejects a server whose tool definitions are too large, silently. Keep descriptions to one line; split rather than compress.
- **No API keys ship, ever** (2026-04-05). Keys are entered in the TrayApp, verified live, stored only in the installed `qwen_config.json`. The full git history was searched for every provider's key prefix in April 2026 and found clean; `qwen_config.json` is gitignored and was never committed.
- **Live key verification** (green ✓ / red ✗) like SmartScribe and AI Studio Pro (2026-04-05).
- **The installer runs elevated** so the bundled Node.js MSI installs (v1.1.0).
- **Back up data before any change** that could touch it (2026-11-11: "they're projects you're working on").
- **Same methodology as SongSpark and Takehouse** (2026-11-11): this ground truth, phased Claude Code prompts `docs\Pn_prompt.md` → `docs\Pn_OUTPUT.md`, `.bak_YYYYMMDD_HHMM` backups before edits, root kept clean.
- **Claude may fix what it finds** (2026-11-11: "if you find something you want to fix or change, just do it"), carefully, without breaking what other sessions depend on.
- **CDS teaches the method** (2026-11-11). Every project should have a `docs\` folder with a `GROUND_TRUTH.md`, basic instructions for writing code, how outputs are reported (`Pn_prompt.md` → `Pn_OUTPUT.md`), and the working conventions. When Claude walks into a project without them, CDS must say so and offer to create them. CDS is public, so this is how other people's projects get pushed toward ground truths.
- **A fresh install on a stranger's PC must simply work** (2026-11-11). No assumptions about Dan's drives, folders, keys or tools.
- **CDS is Claude's project; Claude decides** (2026-11-11: "you have basically total control of the decisions ... unless it's obviously the wrong choice"). From P2 on, **Claude starts and runs the phased Claude Code sessions itself**, headless, on **Opus 5.5 at high effort** (`claude -p ... --model claude-opus-5-5 --effort high`); Dan's steps (installing the VSIX, publishing a release) come to him as a short list.
- **DEC002: three ways to run a phase; collaborative is the default** (2026-11-12). **Manual:** the user hands the prompt to Claude Code in a visible window and approves as it asks. **Delegated:** chat-side Claude runs it headless and answers every question itself (how CDS has been built). **Collaborative** (default, "the best"): headless; chat-side Claude answers a question itself when the answer follows from the ground truth or decisions already made, is easily undone, and is technical; it goes to the user when it changes scope, cost or the product's direction, can't be undone, or is a matter of taste; either way the user is told what was asked and answered. Dan: "the chat side … has the bigger picture … It has the ground truth … and it can talk to me about it. Claude Code just doesn't … it compacts fairly regularly." Also: **the Claude Code integration is a core feature**, so setting it up is the default when Claude Code is present, without the hoops (install, sign in, restart Claude Desktop, tick a box). Done in P9.
- **Efficiency is the point** (2026-11-11). Dan runs heavy engineering on a Max plan and rarely passes ~80% of his allowance because the method is efficient; fewer tokens for the same result is good for the user and for Anthropic. CDS must keep what it puts into context short and useful: state and next steps first, history on request.

---

## 6. Decisions (Claude)

- **The CLI owns the memory format; MCP is a thin wrapper** (the original design: "keep the MCP server simple, do heavy lifting in the CLI"). Every write goes through the CLI.
- **The real store is the CLI's: Windows' Documents folder** (`MyDocuments`, OneDrive-redirected on Dan's PC). The CLI, the VS Bridge and the backups already used it; only `index.js` didn't. `index.js` asks Windows for the same folder (PowerShell `[Environment]::GetFolderPath('MyDocuments')`, once, on first use).
- **The CLI is called with an argument array (`execFile`), not through PowerShell.** Paths with spaces and JSON with quotes pass exactly; no quoting bugs.
- **No silent fallback.** If the CLI fails, the tool returns an error that says the entry was NOT recorded. (v1.2.x wrote its own file and said "✓ recorded", which hid this bug for seven months.)
- **`claudedev_load` creates the memory on first use.** Sessions refused to run `init` ("the prompt only asked for load"); a project folder that exists should just work. `claudedev_init` stays, for anyone who calls it.
- **The old store is read, never written,** by load, stats, check and resume, so deploying v1.3.0 loses nothing even before the merge.
- **`check_mistake` uses a keyword-overlap rule** (≥ 3 shared 4+-letter words making ≥ 30% of the smaller word set), the same in the CLI (`MistakeMatching`, `MemorySchemas.cs`) and the servers (`cds-context.js`, `cds-search.js`): they must stay in step. It also checks the lessons for every project.
- **`stats` counts the stored files** instead of the CLI's report (uptime, a token counter that is never updated, today's activity only).
- **Project paths are normalised** (`path.resolve`): a trailing backslash would give the CLI an empty project name.
- **Load points at the rules, not copies of them** (P12): when a project has `HOW_WE_WORK.md`/`CONVENTIONS.md`, load prints one line naming them; the rules themselves live in the project's files (from the scaffold's templates), so a Claude Desktop project's instructions need only `Load CDS for <folder>`.

---

## 7. Known Problems (open, deferred, and seen: watch for them)

*Fixed, done, removed and handled items are in `docs\history\GROUND_TRUTH_history.md`, §7, under their numbers: 1–18, 20, 21, 23, 24, 26, 27, 29, 30, 31, 32, 34. Numbers are not reused.*

19. **The first install is slow in Windows Sandbox because of Windows Installer, not CDS (P4, measured):** in the sandbox each signed MSI spends 120 s in Windows Installer's "SOFTWARE RESTRICTION POLICY: Verifying package" step, network on or off (.NET 8: four MSIs, 8 min; Node.js: 2 min). Not revocation lookups, not the installer's switches; likely the sandbox's Smart App Control in evaluation mode (inference). Not measured on a real PC without .NET 8. Numbers in `docs\P4_OUTPUT.md`; the full text in the history file.
22. **Seen (P6), not a CDS bug, watch on Dan's upgrade: after an in-place VSIX upgrade in a per-user hive, Visual Studio kept loading the removed folder.** In the experimental instance Visual Studio's package cache still pointed at the deleted folder ("Could not load file or assembly ...\<old folder>\CdsVsBridge.dll"); a reset hive (`CreateExpInstance /Reset`) plus a fresh install fixed it. Dan's VS gets the VSIX per machine through the installer, a different path; `claudedev_vs_get_output` pane "list" (or `vs_events.jsonl`'s `extension_loaded` version) shows whether the new bridge loaded.
25. **Seen (P7), not a bug: CDS's SessionStart hook doesn't run on a resumed session** (its matcher is `startup|clear|compact`; a `--resume` run fires `SessionStart:resume`), so a phase reply gets no fresh load context. Right for a reply (the session already has it); the automatic handoff at its end is still written.
28. **Seen (P9): Claude Code's workspace trust prompt comes first in a manual window** in a folder not trusted yet ("Accessing workspace … Yes, I trust this folder"); the prompt is sent after the user answers it. Answering writes the trust into the user's `~/.claude.json`, so the tests never answer it; the real T2/T7 runs stopped there.
33. **Found (P10), not changed: the smoke test wrote to the real store before P10.** Its main checks made a throwaway project's memory folder in `[Documents]\ClaudeDevStudio\Projects` and removed it at the end. From P10, with `--cli`, the whole run uses a throwaway root (also for the installed copy: `smoke.mjs <installed index.js> --cli <installed claudedev.exe>`); without `--cli` it still does the old thing (an older CLI ignores `CDS_MEMORY_ROOT`).
35. **DEFERRED (Dan, 2026-11-12): AI delegation (`qwen_generate`, `list_models`, `generate_image`) is behind; come back to it later.** Built in v1.2.0 (April) and not changed since. Checked 2026-11-12 against each provider's model list (Dan's five keys all valid): the configured models of **Groq, DeepInfra and Fireworks** (Llama 3.3 70B) are **no longer listed**, so `json`, `fast`, `prose`, `cheap` and `broad` most likely fail; Together (Qwen3-Coder-480B, `code`) and OpenRouter (Qwen3.5-397B) are listed. Nothing logs usage (`log_path` empty), the budget only warns, prices are April's, and nothing reports a retired model. **Dan's direction for the rework:** we rely on Anthropic for our own work (Haiku beats most of these for simple work; Claude Code for most of the rest), so delegation is for other users who want something else, and for handing code work to large models only. **Drop Groq** (not capable enough for what we'd hand off). Dan has a list of other providers he has signed up for recently, to swap in or add: ask him for it when this comes up. Also then: current models and prices checked against the providers' own pages, usage logging on by default, a budget that stops calls, a plain message for a missing model, a test that catches retired models. Check script: `D:\Backups\ClaudeDevStudio\check_models.mjs` (prints found/not listed, never keys).
36. **DEFERRED (Dan, 2026-11-12): the update check is thin; come back to it later.** `UpdateChecker.cs` (GitHub `releases/latest` for `dectdan/Claude-Developer-Studio`, version from `HKCU\Software\ClaudeDevStudio\Version`): the tray app checks once at startup (a balloon "… is available! Click to download.") and on "Check for Updates…"; the Dashboard's About page has a button. It never installs (deliberate: the installer quits Claude Desktop and backs up memory first). Problems: (1) only at startup, so a PC that stays signed in for weeks never hears of a release: also check once a day; (2) it looks for an `.msi` asset, so it opens the release page instead of `ClaudeDevStudio-Setup.exe`: look for the `.exe`; (3) `CheckForUpdatesAsync` swallows every error and returns "no update", so the manual check says "You're running the latest version" when GitHub was unreachable: say "couldn't check"; (4) the About page says "Automatic update notifications": make it true or reword it.

---

## 8. Open Questions

None. Dan handed decisions to Claude on 2026-11-11 (§5). The settled ones are in the history file, §8.

---

## 9. Plan

Nothing open in the plan. Further work comes from using CDS on Dan's projects; the one deferred item is §7 item 35 (AI delegation), when Dan brings it up. The website (`D:\websites\claudedevstudio.com`, one page) follows each release; publishing it is Dan's (how it's hosted: its README). Every phase so far: §12; their prompts and outputs: `docs\Pn_prompt.md`, `docs\Pn_OUTPUT.md`.

**How the producer runs a phase:** from the Claude Desktop chat, with the workbench tools: write `docs\Pn_prompt.md` (the sections in the templates' `HOW_WE_WORK.md`, ending with the stop line); `claudedev_phase_start` `{ project_path: "D:\\Projects\\ClaudeDevStudio", phase: "Pn", model: "claude-opus-5-5", effort: "high" }` (collaborative by default; add e.g. `mcp__cds-workbench__claudedev_vs_get_output` in `allowed_tools` only if a phase needs the VS Bridge); `claudedev_phase_status` every 15–20 minutes (works from a new chat or after Claude Desktop restarted); a question: answer as the mode says, with `claudedev_phase_reply`; if it goes wrong, `claudedev_phase_stop`; then read `docs\Pn_OUTPUT.md` and verify. A phase prompt says to run long steps in the foreground (a foreground command may be given up to 60 minutes). `tools\phase\run-phase.ps1`/`phase-status.ps1` still work but aren't needed.

---

## 10. Build, Deploy, Release

**Build the installer:** `powershell -NoProfile -ExecutionPolicy Bypass -File Installer\build-setup.ps1` → `Installer\Output\ClaudeDevStudio-Setup.exe` (~200 MB, a few minutes). From source, stopping at the first failure: `dotnet publish` CLI, TrayApp, Dashboard; the VSIX with Visual Studio's MSBuild; stages the servers, `templates\*.md`, helper scripts, the Review Panel (never a `qwen_config.json` or a `.pdb`) and the signed runtimes; `tools\check-versions.ps1`; `tools\check-build-paths.mjs` (no build-machine paths); NSIS. Prints the size and SHA-256. Warnings today: CLI 24, TrayApp 14, Dashboard 0, VSIX 12 (0 errors). Needs the .NET 8 SDK, Node/npm, NSIS, VS or Build Tools 2022+ with the extension SDK. `.github\workflows\release.yml` runs the same script, manual only; never run on GitHub.

**Tests:**
- `node mcp-server\test\smoke.mjs --cli <claudedev.exe>` (e.g. `Installer\build\CLI\claudedev.exe`): 218 checks, all on a throwaway memory root in `%TEMP%` (the VS tools against a fake bridge, the phases against a fake Claude Code, `test\fixtures\`); groups a given copy can't run are skipped and named. **The installed copy:** `node mcp-server\test\smoke.mjs %LOCALAPPDATA%\ClaudeDevStudio\mcp-server\index.js --cli %LOCALAPPDATA%\ClaudeDevStudio\CLI\claudedev.exe`. Without `--cli` it uses the real store (§7 item 33).
- `node mcp-server\test\show.mjs claudedev_load <project>` (or `claudedev_search "<query>"`, `--tools`): what Claude would see, read-only tools only. `tools\check-versions.ps1`; `node mcp-server\test\caller-check.mjs <url>` (Review Panel, VS Bridge); `node tools\sandbox-test\claude-code-setup-test.js` (25 checks) and `config-merge-test.js` (28) on throwaway files; `cds-vsix.ps1 -Action install -Vsix <vsix> -ListOnly`.
- **Windows Sandbox, a new user:** `powershell -NoProfile -ExecutionPolicy Bypass -File tools\sandbox-test\run-sandbox-test.ps1` (no elevation, one at a time, ~20–30 min, `-TimeoutMinutes` 60): scenarios A fresh install, B upgrade (keys, the pre-upgrade backup), C uninstall, D Documents redirected, E Claude Code setup, F no Claude Desktop; `-HostExport <zip>` adds M (an export imported); `-Networking`; also N, S, T. Results in `tools\sandbox-test\results\<run>\`. For small releases (Dan's call) there is no sandbox run: the producer tests on machine 3.
- **How each phase tested its part** (the fakes, the real Haiku runs, the VS experimental instance, console and NSIS probes): the history file, §10, and each `docs\Pn_OUTPUT.md`.

**Never, in a session or a test:** run the installer or uninstaller on Dan's PC (the sandbox and machine 3 are the test machines); run `claudedev claude-code setup` on Dan's PC without `--settings`/`--claude-json` or a throwaway `CLAUDE_CONFIG_DIR`; load a VSIX into Dan's main Visual Studio (the experimental instance only; back up `[Documents]\ClaudeDevStudio\VSBridge\` first); start a real phase in this repository from a test; answer Claude Code's workspace trust prompt in a test (§7 item 28); write to Dan's store (a CLI command by hand gets `CDS_MEMORY_ROOT=<throwaway>`; `claudedev export` only reads the store).

**Copy a fresh build into the installed copy (developer):** `powershell -NoProfile -ExecutionPolicy Bypass -File deploy.ps1 -DryRun` lists what would change; without `-DryRun` it copies what differs, backing up each replaced file under `%LOCALAPPDATA%\ClaudeDevStudio\_deploy_backups\<time>\`; never the keys file or Claude Desktop's config. Then quit Claude Desktop fully and reopen it.

**Release:** by hand on GitHub: tag, the EXE attached (its SHA-256 = the tested one), notes from `docs\releases\RELEASE_NOTES_v<version>.md`. The version is set once in `Directory.Build.props`; `tools\check-versions.ps1` checks every other place that carries it, and the built CLI.

---

## 11. Rules That Bite

- **Claude Desktop's tool-definition limit fails silently:** the server connects, `tools/list` succeeds in the log, and no tools appear. Only `mcp-server-<name>.log` shows it. One-line descriptions; split servers rather than compress.
- **Claude Desktop needs a full quit and reopen** to pick up MCP server changes; a new chat is not enough.
- **Claude Desktop can't find bare `node`:** the config uses `C:\Program Files\nodejs\node.exe`.
- **Documents may be redirected (OneDrive).** Never build a path from `%USERPROFILE%\Documents`; ask Windows (`MyDocuments`). This bug has now happened twice (VS Bridge in v1.2.1, memory in v1.3.0).
- **Never call the CLI through a shell string;** use an argument array.
- **Never report success the tool can't confirm.** A fallback that says "✓" hid the memory bug for seven months.
- **Never ship API keys.** `qwen_config.json` stays gitignored.
- **Back up before touching memory data.** It holds every project's history.
- **PowerShell files written by some file tools get curly quotes;** write them from Python/Node or check them with the PowerShell parser.
- **Claude Code hooks must never hurt a session** (P4): exit 0 always (exit 2 blocks); PreCompact prints nothing (its stdout steers the summary); SessionStart keeps 10,000 characters; SessionEnd hooks share 1.5 s unless `timeout` is set. Errors go to `hooks.log`.
- **A test run inside Claude Code inherits `CLAUDE_PROJECT_DIR`** (P4). Anything that spawns `cds-hook.js` must set or delete it explicitly, or the hook writes to the real project's memory.
- **A timed-out Windows Sandbox run leaves its VM running** (P5): the runner can stop the sandbox's window processes but not `vmmemWindowsSandbox` (needs elevation), and the next launch reattaches to the old VM, so the new run never reports. The script's per-step limits and watchdog end the VM from inside, and the runner refuses to start while `vmmemWindowsSandbox` runs; otherwise close the sandbox window by hand or restart. In the sandbox, `Invoke-WebRequest` needs `$ProgressPreference = 'SilentlyContinue'` for large files.
- **The MCP SDK gives a spawned server only a short whitelist of environment variables** (P5): `StdioClientTransport` without `env` drops anything else (e.g. `CDS_MEMORY_ROOT`), so a test that sets a variable for the server must pass it in `env` explicitly, or it silently runs against the real store.
- **Claude Desktop from claude.ai is a packaged (MSIX) app** (P5): files it creates under AppData may land in `%LOCALAPPDATA%\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Roaming\` and be read from there first; processes it starts (the MCP servers, the CLI) are virtualized the same way. Keep CDS's own data in Documents or in folders that existed before; never assume `%APPDATA%\Claude` is the file Claude Desktop reads (history file, §7 item 20).
- **MSIX write virtualization covers all of the user's AppData** (P6): files a packaged app's process creates under `%LOCALAPPDATA%` are redirected too, not only `%APPDATA%`. CDS data that the CLI or servers create while running under Claude Desktop belongs in Documents.
- **The VS Bridge answers only Host `localhost`** (P6): HTTP.sys has `http://localhost:62000/` registered, so `http://127.0.0.1:62000` gets 400 Bad Request (Invalid Hostname) before the bridge sees it. Probe with `localhost`.
- **`devenv /log` takes an optional file name** (P6): `devenv /rootSuffix Exp /log my.sln` writes the ActivityLog over `my.sln`. Put the solution first and give `/log` its own path.
- **A phase reply must never be a command-line argument** (P7): `claude -p "<text>"` takes its prompt positionally, so a message starting with `--` (e.g. `--dangerously-skip-permissions`) would be read as a flag. `claudedev_phase_reply` sends the message on stdin; the start prompt is fixed text built from a validated phase name.
- **WMI-started processes get the user's default environment, not the caller's** (P7): `Win32_Process.Create` builds it from the user's profile, so a phase never inherits a test's `CDS_*` variables or a parent's `CLAUDECODE`/`CLAUDE_PROJECT_DIR`; a test steers a run through its record or files (the fake's mode is in the prompt file).
- **A `-p` run inside Claude Code can't `sleep` in the foreground** (P7): Claude Code moves a long command to the background and the run waits for it (history file, §7 item 26). A test prompt that "takes a while" gets a result early and keeps running.
- **A `-p` run's foreground commands are capped at 10 minutes unless `BASH_MAX_TIMEOUT_MS` is raised** (P8): a longer `timeout` is accepted silently, and at 600 s the command moves to the background and the run prints an early result. Phases get 60 minutes from 1.6.0; a session started otherwise doesn't.
- **Node's `windowsHide` gives a child a console of its own** (P8), so a console Ctrl+C sent to the parent's console never reaches it; spawn without it (inside an already hidden console) when the child must get Ctrl+C. **Node also puts spawned children in a kill-on-close job object:** when the parent exits, its non-detached descendants are ended with it.
- **Ctrl+C to another console:** `FreeConsole`, `AttachConsole(pid)`, a handler that returns true, `GenerateConsoleCtrlEvent(CTRL_C_EVENT, 0)`; never generate the event unless the attach succeeded (it would hit your own console's processes).
- **WMI's `Win32_Process.Create` can't start an app execution alias** such as `%LOCALAPPDATA%\Microsoft\WindowsApps\wt.exe` (it returns 8) (P9); start it directly: Windows Terminal hosts the new window in its own process, outside the caller's tree. **Node's `fs.existsSync`/`statSync` say an app alias doesn't exist** (a reparse point stat can't follow); use `lstatSync`.
- **Never end a console host (`conhost.exe`/`OpenConsole.exe`) when sweeping a process tree** (P9): it is the window; ending it closed a manual run's window before its last note.
- **Windows' Do Not Disturb keeps notifications off the screen** (P9): to test the tray's events, use `CDS_TRAY_EVENT_LOG`, not a screenshot.
- **A test reading a fake's call log right after a start can race it** (P9, the first sandbox run): wait for the call to appear (the sandbox is slower than the host).
- **A "read-only" CLI command can write** (P10): `SessionStateManager.GetMemoryPath` created a project folder in the real store whenever asked (fixed in 1.7.0). Before running an old command in a test, read what it touches.
- **OneDrive marks folders read-only** (P10), and `RemoveDirectory` refuses a read-only folder even when empty: clear the attribute first. CDS's own code never deletes folders.
- **A process that must outlive a Node caller and not hold its pipes** (P10, the daily backup started by load): start it with ShellExecute (`UseShellExecute = true`, hidden). With `UseShellExecute = false` .NET passes the parent's std handles (Node's pipes), and Node's `execFile` waits until the child closes them.
- **The first read of each file in a OneDrive folder is slow** (P10: Dan's store zipped in 8.9 s, then 0.4 s). Keep such work off the hook's path.
- **A program that reads another's output names the encoding, and the writer writes that one** (P11). .NET's `Process` defaults to the console's code page; `Console.OutputEncoding = …` throws without a console (set `Console.SetOut(new StreamWriter(…, new UTF8Encoding(false)))` instead); Windows PowerShell 5.1 and `where.exe` write the OEM code page to a pipe (prefix `PS_UTF8`; don't read `where`); NSIS reads and writes ANSI (programs write their own lines to the installer's log with `--log`; NSIS's own go through `LogUtf8`). Text whose reader can't be told gets ASCII marks. makensis reads a BOM-less script as ANSI (`setup.nsi` stays ASCII).
- **When a log line's format changes, search the test kit for every pattern of the old line** (P11: a second `\[setup\] Claude Code:` filter in scenario E cost a 20-minute sandbox rerun).
- **Test in proportion to the change** (Dan, LSN013): ask what the change could break and the cheapest check that catches it; the full battery (installer, sandbox, every scenario) only for installing, upgrading, data handling or shared code; the output says what was skipped and why. v1.7.2, an icon release, started the whole sandbox suite; machine 3 plus reading the icons back from the built exes was enough.
- **`build-setup.ps1` stops at the version check when `bin\Release\net8.0\claudedev.exe` is older than the version** (P12: it still said 1.7.2): after changing the version, run `dotnet build ClaudeDevStudio.csproj -c Release` first.
- **Bash heredocs and `sed` in this environment mangle backslashes** (again in P4: `\\n` and Windows paths). Write scripts with the file tools, edit Windows paths with the Edit tool.

---

## 12. Prompt History

*One short row per phase: an index, not a log. The details are in each `docs\Pn_OUTPUT.md`; the longer rows these replaced are in the history file, §12.*

| Prompt | Date | What |
|---|---|---|
| — | 2026-11-11 | Producer: audit, backups, `index.js` v1.3.0 (the split memory), the store merge, this ground truth. |
| P1 | 2026-11-11 | CLI IDs, mistake matching, UTF-8 output, session state; one version; VS Bridge and Review Panel caller checks. |
| P2 | 2026-11-11 | An installer that keeps the user's servers, keys and PATH; repo clean-up; safe `deploy.ps1`; sandbox kit. v1.3.0. |
| P3 | 2026-11-11 | Load leads with the handoff and the ground truth; `claudedev_scaffold` and templates; handoffs, decisions. |
| P4 | 2026-11-11 | `cds-context.js`, the Claude Code hook and its setup; installer polish. v1.4.0. |
| P5 | 2026-11-11 | `claudedev_search`; lessons for every project; a PC without Claude Desktop. |
| P6 | 2026-11-12 | Contact address; debug monitor removed; VS Debug pane; CLI state in Documents; sandbox limits. v1.5.0. |
| P7 | 2026-11-12 | Phases from chat: `claudedev_phase_start`/`_status`/`_reply`/`_stop`. |
| P8 | 2026-11-12 | Phases wait properly (60-minute ceilings, Monitor); Stop with Ctrl+C first; the method in the templates. v1.6.0. |
| P9 | 2026-11-12 | Phase modes (DEC002); `QUESTION:` blocks; Phases page, notifications; Claude Code set up by default. |
| P10 | 2026-11-12 | Whole-store backups, export/import, restore, sync line, conflict copies; `git`/`cloud`/`sync` removed. v1.7.0. |
| P11 | 2026-11-12 | Text reads right everywhere (UTF-8, ASCII marks, `install.log`); no build paths in the binaries. v1.7.1. |
| — | 2026-11-12 | Producer: new icon. v1.7.2. |
| P12 | 2026-11-12 | Load points at the rules; the templates carry Dan's whole method; this file back to current state. v1.7.3 (not published). |
