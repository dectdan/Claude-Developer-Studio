# ClaudeDevStudio — Ground Truth

*Last updated: 2026-11-11 (P3 done: load leads with the project's ground truth and last handoff under a size budget; scaffold, handoff and decision tools; workbench finds Documents like index.js. Not deployed; P4 releases v1.4.0)*

Read this first. It is the single source of truth for the project. Older status files are in `docs\history\` and describe states that no longer exist.

---

## 1. What This Is

**ClaudeDevStudio (CDS)** gives Claude persistent memory of software projects across sessions, plus a workbench of developer tools, through Claude Desktop's MCP protocol.

- **Origin:** Dan asked Claude what it would build to make its own existence better; CDS was Claude's answer. Claude designed it; Dan's name is on it for licensing and copyright. (Dan, 2026-11-11: "this is your baby.")
- **Who uses it:** Claude itself, in Claude Desktop chats and in Dan's Claude Code sessions. Every phased prompt in Dan's other projects starts with `claudedev_load` (SongSpark, Takehouse, Lazarus, SynapseBridge, Argus...).
- **Distribution:** free, MIT licence, public repository, Windows 10/11 x64 installer from GitHub releases.

---

## 2. Status

- **2026-02 to 2026-03:** CLI, TrayApp, Dashboard, backups, debug monitor built (see `docs\history\`).
- **2026-04-05, v1.2.0:** the single MCP server (21 tools) silently exceeded Claude Desktop's tool-definition limit; split into `claudedevstudio` (memory, 9 tools) and `cds-workbench` (13 tools). Direct `claude_desktop_config.json` entries replace the Claude Extensions registration. API key auto-verification in the TrayApp. `list_models`. (`docs\releases\RELEASE_NOTES_v1.2.0.md`)
- **2026-04-10, v1.2.1:** VS Bridge read-back fixed for OneDrive-redirected Documents (workbench only). (`docs\releases\RELEASE_NOTES_v1.2.1.md`)
- **2026-04 to 2026-11:** Claude Code sessions in Dan's other projects repeatedly reported `claudedev_init` failing ("Project path does not exist") and `claudedev_load` returning "No CDS data found"; prompts began calling it "the known issue" (Takehouse P1/P2 and the Maestro reports, SongSpark P1, DramatisStudioV2 P159).
- **2026-11-11, producer session (Claude in claude.ai, Dan away part of the time):**
  - **Root cause found: the memory was split in two.** See section 7, item 1. Every `record` and `check` call from MCP had silently failed since MCP became the main way Claude uses CDS; only the MCP server's own fallback files were saved.
  - **Backed up first:** both memory stores copied and zipped to `D:\Backups\ClaudeDevStudio\2026-11-11_memory_before_fix\`, verified file by file (MD5): 2,169 files and 702 files, 0 missing. The installed and source `index.js` from before the fix are there too.
  - **Fixed in source: `mcp-server\index.js` v1.3.0** (section 6). `mcp-server\test\smoke.mjs`: 16/16 pass. Checked on real data read-only (ClaudeDevStudio, SynapseBridge, Takehouse): load and stats under 1 s; the keyword mistake check catches a real recorded mistake.
  - **Not deployed.** The installed copy (`%LOCALAPPDATA%\ClaudeDevStudio\mcp-server\index.js`) is still the broken v1.2.x. Deploying is one file copy and a full Claude Desktop restart (section 10).
  - **Merge script written, dry run only:** `tools\merge-memory-stores.mjs`. It would add 1,917 activities, 210 mistakes, 36 files (5 as renamed copies), 1,082 chat-mirror lines; 0 unreadable; never changes the old store. Waiting for Dan.
  - **Repo tidied:** 28 old status/report files moved (`git mv`) to `docs\history\`; release notes to `docs\releases\`; `Program.cs.broken`, `temp_mistake.json` and an old `index.js` backup to `docs\history\attic\`. Nothing deleted. Committed locally, not pushed.

- **2026-11-11 12:03, D1 done:** `index.js` v1.3.0 copied to the installed `mcp-server` (hash matches source; previous copy kept as `index.js.bak_20261111_1203`); smoke test against the installed copy 16/16. Dan restarting Claude Desktop.

- **2026-11-11, P1 done (Claude Code, `docs\P1_OUTPUT.md`):** in source only, nothing deployed. CLI: unique IDs, keyword mistake matching (same rule as `index.js`), UTF-8 output and `Program.cs` mojibake repaired, `load` saves the session (new session after 8 h). One version 1.3.0 (`Directory.Build.props`, `tools\check-versions.ps1`: 16 places agree). VS Bridge and Review Panel refuse web pages and foreign Hosts. `index.js`: `CDS_CLI_PATH` for tests; "older entries" note only when shown. `smoke.mjs --cli` 24/24; installed CLI 16/16; `caller-check.mjs` 7/7 on the Review Panel (port 63099). Warnings unchanged (CLI 42, TrayApp 23, Dashboard 9, VSIX 12).

- **2026-11-11, P2 done (Claude Code, `docs\P2_OUTPUT.md`):** nothing installed on Dan's PC, nothing published. The installer keeps the user's other servers, settings, API keys, PATH and auto-start choice (`cds-config.js`, `cds-path.ps1`); VS Bridge into any Visual Studio 2022+ via `vswhere` (`cds-vsix.ps1`); bundles the .NET 8 Desktop Runtime (installs offline); `/S` works. `claudedev configure-claude` no longer overwrites the config. No Dan-specific paths in shipped files; DebugView, old MSIs, WiX/MSIX files, `MCP\`, `VoiceServer\`, `mcp-server\claudedev.exe` removed from the tree. `release.yml` manual-only; `deploy.ps1` rewritten; README for strangers; release notes. Installer 194.1 MB, SHA-256 `CB86B708697FA7A25B0DC686A4E98C0C4620D5DBD0DAB1A4AE3F5DD980F3186D`. **Windows Sandbox (offline, new user): 41/41 checks pass** (A install, B upgrade, C uninstall, D Documents redirected). Host: smoke 16/16 and 24/24; `config-merge-test.js` 28/28; warnings unchanged (42/23/9/12), NSIS 0.

- **2026-11-11, v1.3.0 published** on GitHub by the producer with Dan's go-ahead (tag `v1.3.0` at `0117181`; the asset is the P2 EXE, SHA-256 `CB86B708…3186D`).

- **2026-11-11, P3 done (Claude Code, `docs\P3_OUTPUT.md`):** in source only, nothing deployed or released. **`load` leads with the project's own state:** the last handoff (with its age), then the ground truth (`docs\GROUND_TRUTH.md`, else any `docs\*GROUND*TRUTH*.md`, else the root): title, Last updated, the last ~2,500 characters of its Status section and its **Next:** line, the questions still open; then the newest `docs\P*_OUTPUT.md` (first section and a list of the rest); then mistakes (10), decisions (5), patterns (5), activity (8). Size budget: aims at 8,000 characters, never over 12,000, lowest sections trimmed first, each cut names its file. **No ground truth:** a short block telling Claude to offer **`claudedev_scaffold`** (creates `docs\GROUND_TRUTH.md`, `CONVENTIONS.md`, `HOW_WE_WORK.md` from `mcp-server\templates\`, never overwrites). **`claudedev_handoff`** (CLI `record <path> handoff`: `session_handoff.md` + `HANDOFFS.jsonl`; the automatic handoff never replaces an explicit one) and **`claudedev_record_decision`** (`DEC###`). New `instructions` text. `workbench.js` finds the VS Bridge folder through Windows (`mcp-server\cds-paths.js`, shared with `index.js`; §7 item 17). 12 tools, `tools/list` 5,471 bytes (was 3,560 for 9). Smoke `--cli` 40/40, installed CLI 29/29 (3 handoff checks skipped, named); CLI warnings 42 (unchanged); the staged installer has the new files. Real loads: ClaudeDevStudio 7,004, SongSpark 5,026, Argus 4,270, CQAutoparts 3,356 characters. README section, CONTRIBUTING rewritten.

- **2026-11-11 15:25, P3 deployed to Dan's PC** by the producer: verified first (smoke `--cli` 40/40, real load 6,940 characters leading with the ground truth, installed copy untouched by P3); `deploy.ps1 -DryRun` listed exactly the 9 expected files; deployed (backups in `%LOCALAPPDATA%\ClaudeDevStudio\_deploy_backups\20261111_1525`); smoke against the installed `index.js` and CLI 40/40. Takes effect in Claude Desktop after Dan's next full restart.

**Next:** P4 (section 9): Claude Code hooks and setup, installer polish, v1.4.0.

---

## 3. Locations

| What | Where |
|---|---|
| Repository | `github.com/dectdan/Claude-Developer-Studio` (**public**, `main`) |
| Source | `D:\Projects\ClaudeDevStudio` |
| Installed program | `%LOCALAPPDATA%\ClaudeDevStudio\` — `CLI\claudedev.exe`, `TrayApp\`, `Dashboard\`, `mcp-server\` (index.js, workbench.js, node_modules, qwen_config.json, qwen_config.template.json), `review-server\`, `VSExtension\CdsVsBridge.vsix`; from v1.3.0 also `cds-config.js`, `cds-vsix.ps1`, `cds-path.ps1`, `install.log` |
| Installer source | `Installer\setup.nsi` (NSIS); `Installer\build-setup.ps1` (builds and stages everything, checks versions, compiles); `Installer\cds-config.js` (adds or removes only CDS's two entries in Claude Desktop's config; run with the installed Node); `Installer\cds-vsix.ps1` (VS Bridge into every Visual Studio that `vswhere` finds); `Installer\cds-path.ps1` (adds or removes only the CLI folder in the user PATH). Downloaded runtimes cached in `Installer\downloads\` (gitignored). |
| Installer tests | `tools\sandbox-test\` (Windows Sandbox, section 10); results in `tools\sandbox-test\results\<run>\` (gitignored) |
| **Memory (the real store)** | `[Documents]\ClaudeDevStudio\Projects\<project folder name>\` where `[Documents]` is Windows' Documents folder (`Environment.SpecialFolder.MyDocuments`). On Dan's PC: `C:\Users\Big_D\OneDrive\Documents\ClaudeDevStudio` |
| Old store (v1.2.x MCP only) | `%USERPROFILE%\Documents\ClaudeDevStudio` — read-only from v1.3.0 on; merged by the script |
| VS Bridge state files | `[Documents]\ClaudeDevStudio\VSBridge\` |
| Claude Desktop config | `%APPDATA%\Claude\claude_desktop_config.json` (entries `claudedevstudio`, `cds-workbench`; from v1.3.0 the installer backs it up as `claude_desktop_config.json.bak-cds-YYYYMMDD-HHMMSS` before each change) |
| AI provider keys | `%LOCALAPPDATA%\ClaudeDevStudio\mcp-server\qwen_config.json` (gitignored; the repo has `qwen_config.template.json` with empty keys). From v1.3.0 the installer creates it from the template only if it doesn't exist; the uninstaller removes it with `mcp-server\`. |
| MCP logs | `%APPDATA%\Claude\logs\mcp-server-claudedevstudio.log`, `mcp-server-cds-workbench.log`, `mcp.log` |
| Backups made 2026-11-11 | `D:\Backups\ClaudeDevStudio\2026-11-11_memory_before_fix\` |

---

## 4. Architecture (as of 2026-11-11)

| Part | Built from | What it does |
|---|---|---|
| **CLI** `claudedev.exe` | root `*.cs`, `ClaudeDevStudio.csproj` (.NET 8) | Owns the memory format and writes it (`ClaudeMemory.cs`, `MemorySchemas.cs`). 27 commands; only `init`, `load`, `record`, `check`, `stats`, `monitor` are used by MCP. |
| **Memory MCP server** `claudedevstudio` | `mcp-server\index.js` (Node, MCP SDK 1.29) | Thin wrapper: writes memory through the CLI, reads the memory files and the project's `docs\` to build `load` context. 12 tools (from P3). The scaffold's templates are `mcp-server\templates\*.md`. |
| **Workbench MCP server** `cds-workbench` | `mcp-server\workbench.js` | 13 tools: VS Bridge ×7, `qwen_generate`, `list_models`, `display_review`, `display_image`, `generate_image`, `fetch_url`. Starts the Review Panel. |
| **Shared paths** | `mcp-server\cds-paths.js` (from P3) | Asks Windows for Documents once (`[Environment]::GetFolderPath('MyDocuments')`): the memory root for `index.js`, the VS Bridge folder for `workbench.js`. Staged by `build-setup.ps1`, copied by `deploy.ps1`. |
| **VS Bridge** | `VSExtension\CdsVsBridge` (VSIX) | Inside Visual Studio: writes state/errors/output files to `[Documents]\ClaudeDevStudio\VSBridge\`; HTTP on `localhost:62000` for debugger/build/navigate/evaluate. |
| **Review Panel** | `review-server\server.js` (Express) | `127.0.0.1:63000`, shows code and images that Claude sends. |
| **TrayApp** | `ClaudeDevStudio.UI` (WinForms) | Tray icon, auto-start, Configure AI Keys (live key verification). |
| **Dashboard** | `ClaudeDevStudio.Dashboard` (Blazor WebView) | Memory browser. Not reviewed in this audit. |
| **Installer** | `Installer\setup.nsi` + `build-setup.ps1` (NSIS) | `ClaudeDevStudio-Setup.exe` (~194 MB from v1.3.0: bundles Node 22.14.0 LTS, the .NET 8 Desktop Runtime and Windows App Runtime 1.8, so it installs offline), admin elevation, `/S` for silent. Adds only CDS's two MCP entries and keeps the rest of Claude Desktop's config (`cds-config.js`). |

**The memory format (written by the CLI):** per project, `Activity\YYYY-MM-DD.jsonl`, `MISTAKES.jsonl`, `DECISIONS.jsonl`, `PATTERNS.jsonl`, `PERFORMANCE.jsonl`, `session_state.json`, `FACTS.md`, `UNCERTAINTIES.md`, `session_handoff.md`, `HANDOFFS.jsonl` (from P3), `file_digests.json`. JSON names are camelCase/explicit (`action`, `description`, `file`; `mistake`, `impact`, `fix`, `lesson`, `severity`; decisions `decision`, `chose`, `reasoning`, `alternatives_considered`, `file`; handoffs `id` `HND###`, `timestamp`, `source` `explicit`/`auto`, `where_i_stopped`, `next_step`, `open_questions`, `notes`). The CLI's project name is `Path.GetFileName(project_path)`.

**Handoffs (from P3), one format:** `record <path> handoff <json>` (the `claudedev_handoff` tool) is an explicit handoff: appended to `HANDOFFS.jsonl` and written to `session_handoff.md`, whose first line is `<!-- cds-handoff: explicit -->`. The automatic one (`claudedev handoff`, or the CLI's context-usage warning) is built from the session state, always appended to `HANDOFFS.jsonl`, and written to `session_handoff.md` only when that file doesn't hold an explicit handoff. (Before P3 the `handoff` command set the token counter to 200,000 to trigger it, and the value stayed in `session_state.json`.)

**Memory MCP tools (from P3, 12):** `claudedev_init`, `claudedev_load` (creates memory the first time), `claudedev_scaffold`, `claudedev_handoff`, `claudedev_record_decision`, `claudedev_record_activity`, `claudedev_record_mistake` (optional `severity`), `claudedev_check_mistake`, `claudedev_stats`, `claudedev_monitor_start`, `claudedev_chat_checkpoint`, `claudedev_chat_resume`. The server `instructions` explain the method in a few sentences (load first; offer the scaffold if there's no ground truth; check risky steps; record activities, mistakes, decisions; a handoff before stopping).

**What `load` shows (from P3), in order:** the header (project, memory folder); the last handoff with its age; the ground truth (first found of `docs\GROUND_TRUTH.md`, `docs\*GROUND*TRUTH*.md`, root `GROUND_TRUTH.md`): its path, title, "Last updated" line, the last ~2,500 characters of the first heading containing "Status" (any level, numbered or not) starting at an entry, its last `**Next:**` line (or, if Status has none, the file's last one), the Open Questions still open (struck-through items dropped, "None" skipped, ~800 characters), a one-line note if `CONVENTIONS.md` or `HOW_WE_WORK.md` is missing; without a Status heading, the first ~1,500 characters. Then the newest `docs\P*_OUTPUT.md` by modified time (title, first section ~1,500 characters, the other `##` headings on one line). Then mistakes (newest 10 of the total), decisions (newest 5 with reasons), facts/uncertainties if they have real content, patterns (top 5), activity (newest 8 of the total). **No ground truth:** a short block saying so, why one helps, and that Claude should offer `claudedev_scaffold` and create it only if the user agrees. **Budget:** aims at 8,000 characters, hard cap 12,000; trimmed in the order activity, patterns, uncertainties, facts, decisions, newest output, open questions, mistakes; the handoff (capped at 2,500) and the Status are never trimmed; each cut ends with a pointer to the full file.

**The scaffold's templates** (`mcp-server\templates\`, generic, for strangers): `GROUND_TRUTH.md` (read this first, Last updated; What this is, Status with a Next line, Locations, Architecture, Decisions, Open questions, Known problems, Plan, Build/test/release, Rules that bite, Prompt history, each with a one-line italic hint), `CONVENTIONS.md` (read before editing, back up, change only what's asked, verify, report what wasn't done, no secrets, ask before the irreversible, a blank project-specific section), `HOW_WE_WORK.md` (the `Pn_prompt.md` → `Pn_OUTPUT.md` loop, where the CDS tools fit, why). `{{PROJECT}}`, `{{DATE}}`, `{{SUMMARY}}` are filled in; files are created with the exclusive flag (never overwritten); a ground truth under another name stops a second one being made.

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
- **Efficiency is the point** (2026-11-11). Dan runs heavy engineering on a Max plan and rarely passes ~80% of his allowance because the method is efficient; fewer tokens for the same result is good for the user and for Anthropic. CDS must keep what it puts into context short and useful: state and next steps first, history on request.

---

## 6. Decisions Made During the 2026-11-11 Fix (Claude)

- **The CLI owns the memory format; MCP is a thin wrapper** (the original design: "keep the MCP server simple, do heavy lifting in the CLI"). Every write goes through the CLI.
- **The real store is the CLI's: Windows' Documents folder** (`MyDocuments`, OneDrive-redirected on Dan's PC). The CLI, the VS Bridge and the backups already used it; only `index.js` didn't. `index.js` asks Windows for the same folder (PowerShell `[Environment]::GetFolderPath('MyDocuments')`, once, on first use).
- **The CLI is called with an argument array (`execFile`), not through PowerShell.** Paths with spaces and JSON with quotes pass exactly; no quoting bugs.
- **No silent fallback.** If the CLI fails, the tool returns an error that says the entry was NOT recorded. (v1.2.x wrote its own file and said "✓ recorded", which hid this bug for seven months.)
- **`claudedev_load` creates the memory on first use.** Sessions refused to run `init` ("the prompt only asked for load"); a project folder that exists should just work. `claudedev_init` stays, for anyone who calls it.
- **The old store is read, never written,** by load, stats, check and resume, so deploying v1.3.0 loses nothing even before the merge.
- **`check_mistake` adds a keyword-overlap check** (≥3 shared 4+-letter words making ≥30% of the smaller word set) because the CLI's check matches only when the plan contains a recorded mistake's whole sentence (`MemorySchemas.cs` `MatchesAction`). The CLI's own check still runs.
- **`stats` counts the stored files** instead of the CLI's report (uptime, a token counter that is never updated, today's activity only).
- **`monitor_start` starts the CLI detached** with output to `monitor.log`; before, a 30-second timeout killed it.
- **Project paths are normalised** (`path.resolve`): a trailing backslash would give the CLI an empty project name.

---

## 7. Known Problems (audit 2026-11-11), worst first

1. **The memory was split in two — FIXED IN SOURCE (v1.3.0), NOT DEPLOYED.**
   - The CLI wrote to `[Documents]` (OneDrive); the MCP server read and wrote `%USERPROFILE%\Documents`. Two stores: 42 project folders in one, 32 in the other.
   - The MCP server called the CLI with the wrong arguments: `init` got the memory folder instead of the project folder ("Project path does not exist"); `record` and `check` left out the project path (the CLI printed its usage and did nothing); `stats` got no path (the CLI used its working folder, which is why the OneDrive store has project folders named `system32` and `app-1.1.2998`); `load` never called the CLI and looked for a `CURRENT_SESSION_STATE.md` nothing writes.
   - Effect: only v1.2.x's fallback files were ever saved; patterns, decisions, session state and the mistake check were bypassed. **No data was lost:** both stores are intact and backed up.
2. **FIXED IN SOURCE (P1); VS Bridge pending Dan's VSIX install.** Both servers dropped the `*` header and answer 403 to a foreign `Origin` or `Host` (the VS Bridge's foreign Host is also refused with 400 by HTTP.sys). Review Panel checked with `mcp-server\test\caller-check.mjs` (7/7). Original problem: **VS Bridge has no caller check (security).** `localhost:62000` accepts `build.*`, `debugger.*`, `navigate` and `evaluate` from any program, and answers any web page (`Access-Control-Allow-Origin: *`). A page open in Dan's browser while VS runs could read build state and output, or drive the debugger (`evaluate` runs code when VS is paused). Fix: drop the `*` header and refuse requests that carry an `Origin` header (browsers always send one; Node never does), or require a token from a file. Needs a VSIX rebuild. The Review Panel (`127.0.0.1:63000`) has the same `*` header; lower risk (it only displays).
3. **FIXED (P2):** `Bundled\` removed from the tree with `git rm` (history untouched, section 8 Q4). Original problem: **Sysinternals DebugView executables are in the public repo** (`Bundled\Dbgview.exe`, `Dbgview64a.exe`, `dbgview64.exe`). Microsoft's Sysinternals licensing FAQ says its utilities may not be distributed in your software or on your website. The installer does not ship them. Remove from the repo (and, Dan's call, from history).
4. **FIXED (P2):** no hardcoded path; it looks in `%LOCALAPPDATA%\ClaudeDevStudio\DebugView\` then on `PATH`, and when DebugView is missing says it needs Sysinternals DebugView, gives Microsoft's page, and where to put `dbgview64.exe`. Whether the monitor stays is P7. Original problem: **The debug monitor can't work on other PCs.** `VSDebugMonitor.cs` needs `dbgview64.exe` in `%LOCALAPPDATA%\ClaudeDevStudio\DebugView` (the installer never puts it there) or the hardcoded `D:\Tools\DebugView`. Decide: document "install DebugView yourself", or drop `monitor` (the VS Bridge covers build errors and output).
5. **FIXED (P1):** each ID is the file's highest + 1 (`NextIdNumber`); old duplicate IDs stay in the stores. Original problem: **CLI mistake IDs repeat.** `RecordMistake` numbers from `_index.TotalMistakes`, but `record` never loads the index, so every mistake is `ERR001` (same for `PAT001`, decisions).
6. **FIXED (P1):** `MistakeMatching` in `MemorySchemas.cs` uses the `index.js` rule (they must stay in step). Original problem: **CLI mistake matching is too strict** (whole-sentence containment). v1.3.0 adds a keyword check in MCP; the CLI's own `MatchesAction` should be fixed too.
7. **FIXED (P1):** UTF-8 console output; the mojibake was only in `Program.cs` (104 sequences), now real symbols. Original problem: **CLI output is double-encoded:** the C# sources contain mojibake (`âœ“` for ✓, `âš ï¸` for ⚠). v1.3.0 cleans the known ones; fix the source files' encoding.
8. **FIXED (P1):** 1.3.0 in `Directory.Build.props`; everything else follows or is checked by `tools\check-versions.ps1` (unused MSIX/WiX files listed in `docs\P1_OUTPUT.md`). Original problem: **Version numbers disagree:** `ClaudeDevStudio.csproj` 1.1.0, CLI help text 1.1.1, `package.json`/`manifest.json` 1.2.0, both servers 1.1.0 (memory server now 1.3.0), installer 1.2.1. One version, one place.
9. **FIXED (P2):** the workflow runs `Installer\build-setup.ps1` (so it builds exactly what a local build does, VSIX with VS MSBuild) and uploads the EXE as an artifact; **manual only** (`workflow_dispatch`, no tag trigger, no release step) because it has never run on GitHub's runner. YAML parses. Original problem: **`.github\workflows\release.yml` still builds `VoiceServer`**, removed in v1.1.1. Not checked whether the workflow currently passes.
10. **FIXED (P2):** rewritten (section 10): fresh CLI publish, both servers, Review Panel; content compare; backups; `-DryRun`; never the keys file or Claude's config. Dry run checked. Original problem: **`deploy.ps1` is outdated and unsafe:** it predates the split (never copies `workbench.js`), deploys whatever CLI is in `bin\Release`, and overwrites the installed `qwen_config.json` (Dan's API keys) with the source folder's copy. Don't use it until fixed.
11. **FIXED (P2):** removed with `git rm`: `Releases\*.msi`, tracked `Installer\Output\*`, `mcp-server\claudedev.exe`, `MCP\`, `VoiceServer\`, the WiX/MSIX files; stale `Installer\*.md` moved to `docs\history\installer\`, `install.ps1` to `docs\history\attic\` (list in `docs\P2_OUTPUT.md`). Original problem: **Old binaries and dead code tracked in git:** `Releases\*.msi` (13 + 14 MB), `Installer\Output\*.wixpdb`, `mcp-server\claudedev.exe`, the `MCP\` folder (an earlier server), the `VoiceServer\` folder, many stale `Installer\*.md` (WiX era).
12. **`vs_get_output` returns the Build pane only** (SynapseBridge P203): the Debug pane still needs a screenshot. Feature request.
13. **FIXED (P1):** `LoadContext` saves the session state; a load more than 8 h after the last activity starts a new session ID. Original problem: **`load` reports a stale session** (e.g. "Session: 2026-02-14_07-26"): nothing updates `session_state.json` after `init`. Either update it on load or drop the line.
14. **FIXED (P2), tested in Windows Sandbox:** `Installer\cds-config.js` (run with the installed Node) adds or replaces only `claudedevstudio` and `cds-workbench`, keeps every other server and top-level key, backs the file up first, writes temp-then-rename UTF-8 without BOM, and leaves a file that isn't valid JSON untouched (finish page says what to add; entries written to `ADD-TO-CLAUDE-CONFIG.txt`). Uninstall removes only the two entries, same rules. `claudedev configure-claude` (the tray app's "Link Claude Desktop") had the same bug and now calls `cds-config.js`. `install-extension.ps1` and `ConfigureClaudeDesktop.ps1` removed. Original problem: **The installer deletes the user's other Claude Desktop servers** (found 2026-11-11 after P1). `install-extension.ps1` rewrites `claude_desktop_config.json` as the two CDS servers plus `preferences`; every other `mcpServers` entry and every other top-level key is lost. On Dan's PC that would have removed 7 of 9 servers (dramatis-studio, alpaca ×3, cpanel, trading-server, machine3-server) and `coworkUserFilesPath`. The uninstaller's PowerShell 5.1 `Set-Content -Encoding UTF8` also writes a BOM. **P2.**
15. **FIXED (P2), tested in Windows Sandbox:** the build stages `qwen_config.template.json` (and fails if a `qwen_config.json` is staged); the installer creates `qwen_config.json` from it only if none exists. Uninstall removes it with `mcp-server\` (as NSIS removes the folder; README says so). Also kept on upgrade now: the user PATH (only the CLI folder is added or removed, by `cds-path.ps1`; NSIS's 1024-character strings could have cut a long PATH) and the auto-start choice (written on a first install only). Original problem: **Upgrading deletes the user's API keys.** The installer copies `build\mcp-server\*.*` with `SetOverwrite on`, and the staged folder holds the empty template saved as `qwen_config.json`, so every upgrade replaces the user's keys with blanks. (The template itself is correct: no keys ship.) **P2.**
16. **FIXED (P2):** `Installer\cds-vsix.ps1` asks `vswhere` for every instance (any edition, version, prerelease) that has `VSIXInstaller.exe` and installs (or, on uninstall, removes) the VSIX quietly per instance (`/instanceIds:`), with a 300 s limit each; no VS or no `vswhere` is a log line, never a failure. The VSIX manifest now accepts `[17.0, 19.0)` (VS 2022 and VS 2026). Sandbox tested the "no Visual Studio" path; `-ListOnly` on Dan's PC lists VS 2022 Community and both Build Tools (Build Tools will refuse the VSIX, which is logged). Not yet run against a real Visual Studio by the installer. Original problem: **The VS Bridge is installed only for Visual Studio 2022** (`setup.nsi` checks three fixed 2022 paths). Newer Visual Studio versions are skipped silently.
17. **FIXED (P3):** `workbench.js` reads the VS Bridge folder from `mcp-server\cds-paths.js`, which asks Windows (`[Environment]::GetFolderPath('MyDocuments')`, once, on the first VS tool call) exactly as `index.js` does for the memory; the installer stages it and `deploy.ps1` copies it. Original problem: **`workbench.js` finds the VS Bridge folder by probing `OneDrive\Documents` then `Documents`** instead of asking Windows (`MyDocuments`) as `index.js` does: with Documents moved anywhere else, the VS Bridge tools read the wrong folder.
18. **Small things found in P2, left:** the Dashboard's and tray app's About/Help links point at `github.com/dectdan/Cloud-Developer-Studio` (the repo is `Claude-Developer-Studio`); the Dashboard reads registry values `InstallPath`/`TrayAppPath` that the installer never writes (it writes `InstallDir`); the bundled Node.js is 22.14.0 (installed only when no Node exists; a newer 22.x or 24 LTS would be better); the finish page's "Start ClaudeDevStudio now" starts the tray app elevated (NSIS runs elevated).

---

## 8. Open Questions

None. Dan handed decisions to Claude on 2026-11-11 (§5). Earlier questions, settled:
1. ~~Deploy v1.3.0?~~ Done (D1), confirmed after the restart.
2. ~~Merge the stores?~~ Claude: yes, after a fresh backup of the real store (D2).
3. ~~Debug monitor?~~ Claude: keep it, but honest: no Dan-specific path; when DebugView isn't installed it says so with Microsoft's download page; the tool description says it needs DebugView (P2). Whether it earns its place next to the VS Bridge is P7.
4. ~~DebugView in git history?~~ Claude: remove from the tree, don't rewrite history. A force-push to a public repo breaks every clone and fork; the files are Microsoft's freely downloadable tools; removing them stops CDS distributing them from now on.
5. ~~Old MSIs and `wixpdb`?~~ Claude: remove from the tree; the MSIs stay attached to their GitHub releases.
6. ~~Version?~~ 1.3.0, set once in `Directory.Build.props` (P1).

---

## 9. Plan

| Step | What | Who |
|---|---|---|
| **D1** | ✓ Done 2026-11-11 12:03: `index.js` v1.3.0 deployed; confirmed after the restart (`claudedev_load` on SongSpark read the real store) | Producer + Dan |
| **D2** | ✓ Done 2026-11-11 12:52–13:05 by the producer. Fresh backup `D:\Backups\ClaudeDevStudio\2026-11-11_before_merge_1252` (728 files). Merged: +1,917 activities, +210 mistakes, 36 files (5 as `.from-old-store` copies), +1,082 chat-mirror lines. Three WebullPortfolio entries had dashed times (`T10-00-00`) and were first stamped with today's date; repaired (wrong files backed up to `...\2026-11-11_merge_repair_WebullPortfolio`), the script fixed to read dashed times and activity-format "mistake" files; a re-run adds nothing (2,127 duplicates skipped). The old store is unchanged and still read by `index.js`. | Producer |

**v1.3.0 — make the public release correct and safe** (today's public installer still ships the broken v1.2.x memory server):

| Step | What | Who |
|---|---|---|
| **P1** | ✓ **Done 2026-11-11** (`docs\P1_OUTPUT.md`); VSIX install + bridge caller check is Dan's step. **Correctness and security in the code.** CLI: unique mistake/pattern/decision IDs; keyword `MatchesAction` (same rule as `index.js`); UTF-8 console output and the mojibake in the C# sources; `load` saves `session_state.json`. One version number everywhere. VS Bridge and Review Panel caller checks (section 7 item 2). `index.js`: the test-only CLI override and the "older entries" note. Smoke test grows. | Claude Code (`docs\P1_prompt.md`) |
| **P2** | ✓ **Done 2026-11-11** (`docs\P2_OUTPUT.md`); **v1.3.0 published 2026-11-11** (tag `v1.3.0` at `0117181`). **A fresh install that just works.** The installer keeps the user's other servers, settings and API keys (§7 items 14–16); no Dan-specific paths anywhere (item 4); repo clean-up (items 3, 11); `release.yml` (item 9); a safe `deploy.ps1` (item 10); README for strangers; installer build; **Windows Sandbox tests as a new user** (fresh install, upgrade keeping keys and other servers, uninstall, then all again with Documents redirected); release notes. | Claude Code (`docs\P2_prompt.md`), then Dan publishes |

**v1.4.0 — memory that finds Claude, and teaches the method:**

| Step | What |
|---|---|
| **P3** | ✓ **Done 2026-11-11** (`docs\P3_OUTPUT.md`); not deployed: the producer deploys it to Dan's PC (`deploy.ps1`). **Next: P4.** **What Claude sees on walking in** (the old P3 and P4 together: both change `load`). **The method:** `load` looks for the project's ground truth; if present it leads with its Status and Next, the latest `Pn_OUTPUT.md` and the last handoff; if missing it says so plainly and offers `claudedev_scaffold`, which creates `docs\GROUND_TRUTH.md`, `docs\CONVENTIONS.md` and `docs\HOW_WE_WORK.md` from generic templates, never overwriting. **Handoffs and decisions:** `claudedev_handoff` and `claudedev_record_decision`, written by the CLI. A size budget for `load`. Item 17. `CONTRIBUTING.md`. Prompt: `docs\P3_prompt.md`. |
| **P4** | **Next.** **Claude Code hooks, installer polish, release v1.4.0** (the version number goes to 1.4.0 here; P3 left it at 1.3.0). Opt-in hooks (SessionStart → load; PreCompact and SessionEnd → automatic handoff, i.e. `claudedev handoff <path>`, which never replaces an explicit one; PostToolUse on edits → a light activity line), set up from the installer or the tray app; item 18; why the .NET install took 8 minutes in the sandbox; installer build; sandbox run; release notes. |
| **P5** | **Search and shared lessons.** `claudedev_search` across all projects' history; a machine-wide lessons file (e.g. "Documents may be redirected", "PowerShell files get curly quotes") checked in every project. |
| **P6** | Debug monitor: keep or drop next to the VS Bridge; `vs_get_output` Debug pane. |
| **P7** | **Claude runs Claude Code from CDS:** workbench tools to start a phase prompt headless in a project (background, logged), read its status, and reply to the same session; one session per project at a time (a lock). Formalises what the producer does by hand from P2 on. |

**How the producer runs a phase (from P2):** Claude Code ≥ 2.1 (updated 2026-11-11 from 2.0.42, which had no `--effort`), signed in to Dan's account; in the project folder, `claude -p "Read docs\Pn_prompt.md and carry it out." --model claude-opus-5-5 --effort high --permission-mode acceptEdits --allowedTools <the commands the phase needs> --output-format stream-json --verbose`, stdin from NUL, started detached with output to `docs\Pn_run.log`; the producer checks the log, reads `docs\Pn_OUTPUT.md`, verifies, writes the next prompt. No `--dangerously-skip-permissions`. **Fresh-install tests run in Windows Sandbox** (built in, a new clean Windows each launch, admin inside, launchable without elevation); Dan's Hyper-V VM needs elevation that headless sessions don't have.

---

## 10. Build, Deploy, Release

**Deploy the memory server fix (D1), from an ordinary PowerShell window:**
```powershell
$inst = "$env:LOCALAPPDATA\ClaudeDevStudio\mcp-server"
Copy-Item "$inst\index.js" "$inst\index.js.bak_$(Get-Date -Format yyyyMMdd_HHmm)"
Copy-Item D:\Projects\ClaudeDevStudio\mcp-server\index.js "$inst\index.js" -Force
node D:\Projects\ClaudeDevStudio\mcp-server\test\smoke.mjs "$inst\index.js"   # expect 16 passed
```
Then quit Claude Desktop completely (tray icon › Quit, not just close the window) and reopen it. **Rollback:** copy the `.bak_` file back, or `D:\Backups\ClaudeDevStudio\2026-11-11_memory_before_fix\index.js.installed_before_fix`.

**Test the memory server any time:** `node mcp-server\test\smoke.mjs` (from P3: 16 + 13 checks; the installed CLI; throwaway projects in %TEMP%, their memory folders removed afterwards; it adds a few lines to the chat mirror; the 3 handoff checks are skipped and named, as they need the new CLI). **A newly built CLI, before installing it:** `node mcp-server\test\smoke.mjs --cli bin\Release\net8.0\claudedev.exe` (16 + 8 P1 + 16 P3 = 40 checks). `node mcp-server\test\show.mjs claudedev_load <project>` prints load's output and its length. **Versions:** `powershell -File tools\check-versions.ps1`. **Caller checks:** `node mcp-server\test\caller-check.mjs http://127.0.0.1:63000` (Review Panel) or `http://localhost:62000` (VS Bridge, VS open). **VSIX build:** VS MSBuild, not `dotnet build` (command in `docs\P1_OUTPUT.md`, Build notes). `node mcp-server\test\show.mjs claudedev_load <project>` prints what Claude would see (read-only tools only).

**Full installer build (from P2):** `powershell -NoProfile -ExecutionPolicy Bypass -File Installer\build-setup.ps1` → `Installer\Output\ClaudeDevStudio-Setup.exe` (~194 MB, about 3.5 min). It always builds from source, in this order, and stops at the first failure (nothing is skipped silently): `dotnet publish` CLI, TrayApp, Dashboard (Release, win-x64, framework-dependent); the VSIX with Visual Studio's MSBuild found by `vswhere` (`-restore -t:Rebuild -p:Configuration=Release -p:DeployExtension=false`); stages `index.js`, `workbench.js`, `cds-paths.js`, `templates\*.md` (from P3), `package.json`, `package-lock.json`, `manifest.json`, `qwen_config.template.json` (never a `qwen_config.json`) and `server.js` with `npm ci --omit=dev`; the three helper scripts; the bundled runtimes from `Installer\downloads\` (downloaded once, each must have a valid Authenticode signature); `tools\check-versions.ps1`; NSIS. It prints the EXE's size, SHA-256 and build time. Needs the .NET 8 SDK, Node/npm, NSIS, and VS or Build Tools 2022+ with the extension SDK. `.github\workflows\release.yml` runs the same script, manual only (`workflow_dispatch`), and uploads the EXE as an artifact; it has never been run on GitHub.

**Test the installer as a new user (from P2), in Windows Sandbox:** `powershell -NoProfile -ExecutionPolicy Bypass -File tools\sandbox-test\run-sandbox-test.ps1` (no elevation; one sandbox at a time; about 15 min; time limit 60 min, `-TimeoutMinutes`). It writes `tools\sandbox-test\results\<run>\sandbox.wsb` (networking off; installer and test scripts read-only; only `results\<run>\` writable) and runs `in-sandbox.ps1` inside: A fresh install over a seeded config and a long user PATH, B upgrade keeping a test API key, C uninstall, D again with Documents redirected. Each check goes into `results.json` with evidence, plus `sandbox.log`, the install/uninstall logs and smoke output. Exit 0 = all passed. `node tools\sandbox-test\config-merge-test.js` tests `cds-config.js` on throwaway files in `%TEMP%` (28 checks). `cds-vsix.ps1 -Action install -Vsix <vsix> -ListOnly` shows which Visual Studio instances it would target without running anything. **Never run the installer or uninstaller on Dan's PC;** the sandbox is the test machine. Releases are published by hand on GitHub with the EXE attached.

**Copy a fresh build into the installed copy (developer, from P2):** `powershell -NoProfile -ExecutionPolicy Bypass -File deploy.ps1 -DryRun` lists what would change; without `-DryRun` it copies. It publishes the CLI fresh and copies all of its output, `mcp-server\index.js`, `workbench.js`, `cds-paths.js`, `package.json`, `package-lock.json`, `templates\*.md` (from P3), and the Review Panel's `server.js`, `package.json`, `package-lock.json`, only where the content differs, backing up each replaced file under `%LOCALAPPDATA%\ClaudeDevStudio\_deploy_backups\<time>\`; runs `npm ci --omit=dev` if a package file changed. It never touches the keys file or Claude Desktop's config. Then quit Claude Desktop fully and reopen it.

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

---

## 12. Prompt History

| Prompt | Date | What |
|---|---|---|
| — | 2026-11-11 | Producer session: audit, backups, `index.js` v1.3.0 and its smoke test, merge script (dry run), this ground truth, `docs\` reorganised; v1.3.0 memory server deployed (D1) and confirmed after restart. |
| P1 | 2026-11-11 | Done: unique CLI IDs, keyword mistake matching, UTF-8 output, `load` saves the session; one version 1.3.0; VS Bridge and Review Panel caller checks; `smoke.mjs --cli` 24/24, `caller-check.mjs` 7/7. Output: `docs\P1_OUTPUT.md`. VSIX install pending (Dan). |
| P2 | 2026-11-11 | Done: installer keeps other servers, settings, keys, PATH (`cds-config.js`, `cds-path.ps1`); VS Bridge via `vswhere`; offline install; `configure-claude` fixed; no Dan-specific paths; repo clean-up; `release.yml` manual-only; safe `deploy.ps1`; README; release notes; Windows Sandbox test kit, 41/41. Output: `docs\P2_OUTPUT.md`. v1.3.0 published 2026-11-11. |
| P3 | 2026-11-11 | Done: `load` leads with the last handoff and the project's ground truth (Status, Next, open questions) and the newest `Pn_OUTPUT.md`, under a size budget (8,000 aim, 12,000 cap); `claudedev_scaffold` and its templates; `claudedev_handoff` (CLI `record ... handoff`, one format with the automatic handoff); `claudedev_record_decision`; new server instructions; `cds-paths.js` (workbench asks Windows for Documents, §7 item 17); README section; CONTRIBUTING rewritten. Smoke `--cli` 40/40, installed 29/29. Output: `docs\P3_OUTPUT.md`. Deploying is the producer's. |
